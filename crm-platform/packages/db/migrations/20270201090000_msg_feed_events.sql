-- msg-feed: the event writer and the rebuild for the message-count rollup (docs/superpowers/specs/2026-10-19-message-count-rollup-design.md).
--
-- What it does. A trigger on `messages` writes one MSG_STATE event (analytics event type 7) when a message is created and one when its status
-- changes, stamped with the message's CREATION time: the rollup MSG_FEED then holds, per hour and per day of creation, how many messages are in
-- each status NOW, by channel and by source and kind class. That is exactly what the Message History cards, the volume chart and the type mix count
-- from `messages` today, so the numbers match. A second event, CONV_FIRST_REPLY (type 42), is written when a conversation gets its first reply.
--
-- Cut-over. Messages created before this migration have no events: `an_msg_feed_cutover()` is the instant, a constant. The trigger only writes
-- for messages created at or after it; the rollups for older messages (metrics MSG_FEED_BASE 6 and CONV_REPLY_BASE 7) are built from `messages` by
-- `an_msg_feed_rebuild_base()`, run by the backfill command and nightly for the last days. A bucket therefore never mixes the two sources.
--
-- Safety. The writer never fails a message: each trigger body is a BEGIN .. EXCEPTION block that logs a warning and returns. It adds about 15 to
-- 30 microseconds to a message insert or a status update (measured, see the design). It writes no message text, number or name.

ALTER TABLE conversations
  ADD COLUMN first_inbound_at timestamptz,
  ADD COLUMN first_replied_at timestamptz;
COMMENT ON COLUMN conversations.first_inbound_at IS 'Creation time of the first customer message (feed-counted); set by the messages trigger, used to time the first reply.';
COMMENT ON COLUMN conversations.first_replied_at IS 'Creation time of the first reply after first_inbound_at; set once by the messages trigger.';

-- Codes: the same as packages/contracts (MESSAGE_STATUS_CODE, SOURCE_KIND, MESSAGE_KIND_CLASS). A test keeps the two in step.
CREATE FUNCTION an_msg_status_code(status text) RETURNS smallint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT CASE status WHEN 'queued' THEN 1 WHEN 'sent' THEN 2 WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 WHEN 'failed' THEN 5 WHEN 'received' THEN 6 END::smallint $$;

CREATE FUNCTION an_msg_kind_class(kind text) RETURNS smallint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT CASE kind WHEN 'text' THEN 1 WHEN 'template' THEN 2 WHEN 'image' THEN 3 WHEN 'video' THEN 4 WHEN 'audio' THEN 5 WHEN 'voice' THEN 5
                         WHEN 'document' THEN 6 WHEN 'sticker' THEN 6 WHEN 'location' THEN 7 ELSE 8 END::smallint $$;

-- The source of a message, as MESSAGE_SOURCE in message-history.query.ts says it, as a SOURCE_KIND code.
CREATE FUNCTION an_msg_source_kind(direction text, meta jsonb, sender_agent_id bigint, sender_kind text) RETURNS smallint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT CASE
    WHEN direction = 'in' THEN 1
    WHEN meta ->> 'source' = 'auto_reply' THEN 8
    WHEN meta ->> 'source' = 'flow' THEN 5
    WHEN meta ->> 'source' = 'ai' THEN 9
    WHEN meta ->> 'source' = 'api' THEN 6
    WHEN meta ->> 'source' = 'broadcast' THEN 3
    WHEN meta ->> 'source' = 'campaign' THEN 2
    WHEN meta ->> 'source' = 'scheduled' THEN 4
    WHEN sender_agent_id IS NOT NULL THEN 9
    WHEN sender_kind = 'agent' OR meta ->> 'source' = 'inbox' THEN 1
    ELSE 10 END::smallint $$;

-- The feed leaves out a line nobody said (system, reaction) and the bubble a broadcast or campaign mirrored into a thread (FEED_MESSAGES in
-- message-history.query.ts). A message deleted by a person IS counted here (decision D10): the stream records that it was sent.
CREATE FUNCTION an_msg_feed_counted(kind text, meta jsonb, provider_message_id text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT kind NOT IN ('system', 'reaction')
          AND NOT (COALESCE(meta ->> 'source', '') = 'broadcast' AND meta ->> 'broadcast_id' IS NOT NULL)
          AND NOT (COALESCE(meta ->> 'source', '') = 'campaign'
                   AND (meta ->> 'campaign_id' IS NOT NULL OR COALESCE(provider_message_id, '') LIKE 'campaign:%')) $$;

-- The first reply of a conversation: the first feed-counted outgoing message created after the first feed-counted incoming one. Called from the
-- insert trigger of an outgoing message. State lives in conversations.first_inbound_at / first_replied_at; for a conversation that existed before
-- this migration the state is filled in here, once, from `messages` (a reply already made before the cut-over is the base rollup's, so none is written).
CREATE FUNCTION an_msg_first_reply(p_org bigint, p_conv bigint, p_created timestamptz, p_user bigint, p_channel bigint) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  fin timestamptz;
  fr timestamptz;
  earlier timestamptz;
BEGIN
  SELECT c.first_inbound_at, c.first_replied_at INTO fin, fr
    FROM conversations c WHERE c.org_id = p_org AND c.id = p_conv;
  IF fr IS NOT NULL THEN RETURN; END IF;
  IF fin IS NULL THEN
    SELECT min(m.created_at) INTO fin FROM messages m
     WHERE m.org_id = p_org AND m.conversation_id = p_conv AND m.direction = 'in' AND m.kind NOT IN ('system', 'reaction');
    IF fin IS NULL THEN RETURN; END IF;
    UPDATE conversations SET first_inbound_at = fin
     WHERE org_id = p_org AND id = p_conv AND first_inbound_at IS NULL;
  END IF;
  IF p_created <= fin THEN RETURN; END IF;
  -- an earlier reply than this one (made before the cut-over, or by a racing message): that is the first, and it is already counted
  SELECT min(m.created_at) INTO earlier FROM messages m
   WHERE m.org_id = p_org AND m.conversation_id = p_conv AND m.direction = 'out' AND m.kind NOT IN ('system', 'reaction')
     AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id) AND m.created_at > fin AND m.created_at < p_created;
  IF earlier IS NOT NULL THEN
    UPDATE conversations SET first_replied_at = earlier WHERE org_id = p_org AND id = p_conv AND first_replied_at IS NULL;
    RETURN;
  END IF;
  UPDATE conversations SET first_replied_at = p_created
   WHERE org_id = p_org AND id = p_conv AND first_replied_at IS NULL;
  IF FOUND THEN
    INSERT INTO an_events (org_id, type, recorded_at, occurred_at, direction, channel_id, conversation_id, agent_id, duration_ms, qty)
    VALUES (p_org, 42, clock_timestamp(), p_created, 2, p_channel, p_conv, p_user,
            LEAST(2147483647, (extract(epoch FROM p_created - fin) * 1000)::bigint)::integer, 1);
  END IF;
END $$;

-- AFTER INSERT: the message enters its first status.
CREATE FUNCTION an_msg_event_insert() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ch bigint;
BEGIN
  IF NEW.created_at < an_msg_feed_cutover() OR NOT an_msg_feed_counted(NEW.kind, NEW.meta, NEW.provider_message_id) THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT c.channel_id INTO ch FROM conversations c WHERE c.org_id = NEW.org_id AND c.id = NEW.conversation_id;
    INSERT INTO an_events (org_id, type, recorded_at, occurred_at, direction, status, source_kind, k1, channel_id, conversation_id, qty)
    VALUES (NEW.org_id, 7, clock_timestamp(), NEW.created_at, CASE NEW.direction WHEN 'in' THEN 1 ELSE 2 END, an_msg_status_code(NEW.status),
            an_msg_source_kind(NEW.direction, NEW.meta, NEW.sender_agent_id, NEW.sender_kind), an_msg_kind_class(NEW.kind), ch, NEW.conversation_id, 1);
    IF NEW.direction = 'in' THEN
      UPDATE conversations SET first_inbound_at = NEW.created_at
       WHERE org_id = NEW.org_id AND id = NEW.conversation_id AND (first_inbound_at IS NULL OR NEW.created_at < first_inbound_at);
    ELSE
      PERFORM an_msg_first_reply(NEW.org_id, NEW.conversation_id, NEW.created_at, NEW.sender_user_id, ch);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'an_events write failed for message % (%): %', NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END $$;

-- AFTER UPDATE OF status: one event that enters the new status and leaves the old one (the rollup rule is paired on k2).
CREATE FUNCTION an_msg_event_status() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ch bigint;
BEGIN
  IF NEW.created_at < an_msg_feed_cutover() OR NOT an_msg_feed_counted(NEW.kind, NEW.meta, NEW.provider_message_id) THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT c.channel_id INTO ch FROM conversations c WHERE c.org_id = NEW.org_id AND c.id = NEW.conversation_id;
    INSERT INTO an_events (org_id, type, recorded_at, occurred_at, direction, status, k2, source_kind, k1, channel_id, conversation_id, qty)
    VALUES (NEW.org_id, 7, clock_timestamp(), NEW.created_at, CASE NEW.direction WHEN 'in' THEN 1 ELSE 2 END, an_msg_status_code(NEW.status),
            an_msg_status_code(OLD.status), an_msg_source_kind(NEW.direction, NEW.meta, NEW.sender_agent_id, NEW.sender_kind),
            an_msg_kind_class(NEW.kind), ch, NEW.conversation_id, 1);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'an_events write failed for message % (%): %', NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END $$;

-- The cut-over is set below, after the triggers exist and while this transaction still holds the lock that keeps messages from being written:
-- a message created before the instant is in the base rollup, one created at or after it is in the events.
CREATE TRIGGER trg_messages_feed_insert AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION an_msg_event_insert();
CREATE TRIGGER trg_messages_feed_status AFTER UPDATE OF status ON messages
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION an_msg_event_status();

DO $$
BEGIN
  EXECUTE format(
    'CREATE FUNCTION an_msg_feed_cutover() RETURNS timestamptz LANGUAGE sql IMMUTABLE PARALLEL SAFE AS %L',
    format('SELECT %L::timestamptz', clock_timestamp()::text));
END $$;

-- Rebuilds the base rollups of one workspace for [p_from, p_to) from `messages`: hour and day rows of MSG_FEED_BASE (6) and CONV_REPLY_BASE (7),
-- in the workspace's timezone, counting only messages created before the cut-over. The range is widened to whole local days so a day is never half
-- rebuilt. Replaces the rows it covers, so it can run again (backfill, then nightly for the last days while their statuses settle).
CREATE FUNCTION an_msg_feed_rebuild_base(p_org bigint, p_from timestamptz, p_to timestamptz) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  tz text;
  cutoff timestamptz := an_msg_feed_cutover();
  lo timestamptz;
  hi timestamptz;
BEGIN
  SELECT COALESCE((SELECT z.name FROM workspace_settings ws JOIN pg_timezone_names z ON z.name = ws.timezone WHERE ws.org_id = p_org), 'UTC') INTO tz;
  lo := date_trunc('day', p_from AT TIME ZONE tz) AT TIME ZONE tz;
  hi := LEAST(cutoff, (date_trunc('day', (p_to - interval '1 microsecond') AT TIME ZONE tz) + interval '1 day') AT TIME ZONE tz);
  IF lo >= hi THEN RETURN; END IF;

  DELETE FROM an_rollup_hour WHERE org_id = p_org AND metric IN (6, 7) AND bucket >= lo AND bucket < hi;
  DELETE FROM an_rollup_day WHERE org_id = p_org AND metric IN (6, 7)
     AND bucket >= (lo AT TIME ZONE tz)::date AND bucket <= ((hi - interval '1 microsecond') AT TIME ZONE tz)::date;

  -- the feed: messages by creation hour and day and the status each has now
  INSERT INTO an_rollup_hour (org_id, metric, bucket, d1, d2, d3, n)
  SELECT p_org, 6, date_trunc('hour', m.created_at AT TIME ZONE tz) AT TIME ZONE tz, an_msg_status_code(m.status), COALESCE(c.channel_id, 0),
         an_msg_source_kind(m.direction, m.meta, m.sender_agent_id, m.sender_kind) * 16 + an_msg_kind_class(m.kind), count(*)
    FROM messages m LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
   WHERE m.org_id = p_org AND m.created_at >= lo AND m.created_at < hi AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id)
   GROUP BY 3, 4, 5, 6;
  INSERT INTO an_rollup_day (org_id, metric, bucket, d1, d2, d3, n)
  SELECT p_org, 6, (m.created_at AT TIME ZONE tz)::date, an_msg_status_code(m.status), COALESCE(c.channel_id, 0),
         an_msg_source_kind(m.direction, m.meta, m.sender_agent_id, m.sender_kind) * 16 + an_msg_kind_class(m.kind), count(*)
    FROM messages m LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
   WHERE m.org_id = p_org AND m.created_at >= lo AND m.created_at < hi AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id)
   GROUP BY 3, 4, 5, 6;

  -- first replies made in the range: per conversation, the first feed-counted outgoing message after its first incoming one
  CREATE TEMP TABLE an_base_replies ON COMMIT DROP AS
  SELECT f.channel_id, r.reply_at, LEAST(2147483647, (extract(epoch FROM r.reply_at - f.fin) * 1000)::bigint) AS ms
    FROM (SELECT m.conversation_id, min(m.created_at) AS fin, c.channel_id
            FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
           WHERE m.org_id = p_org AND m.direction = 'in' AND m.kind NOT IN ('system', 'reaction')
             AND m.conversation_id IN (SELECT DISTINCT m2.conversation_id FROM messages m2
                                        WHERE m2.org_id = p_org AND m2.created_at >= lo AND m2.created_at < hi)
           GROUP BY m.conversation_id, c.channel_id) f
    CROSS JOIN LATERAL (SELECT min(o.created_at) AS reply_at FROM messages o
                         WHERE o.org_id = p_org AND o.conversation_id = f.conversation_id AND o.direction = 'out'
                           AND o.kind NOT IN ('system', 'reaction') AND an_msg_feed_counted(o.kind, o.meta, o.provider_message_id)
                           AND o.created_at > f.fin) r
   WHERE r.reply_at >= lo AND r.reply_at < hi;
  INSERT INTO an_rollup_hour (org_id, metric, bucket, d1, n, s1)
  SELECT p_org, 7, date_trunc('hour', reply_at AT TIME ZONE tz) AT TIME ZONE tz, COALESCE(channel_id, 0), count(*), sum(ms) FROM an_base_replies GROUP BY 3, 4;
  INSERT INTO an_rollup_day (org_id, metric, bucket, d1, n, s1)
  SELECT p_org, 7, (reply_at AT TIME ZONE tz)::date, COALESCE(channel_id, 0), count(*), sum(ms) FROM an_base_replies GROUP BY 3, 4;
  DROP TABLE an_base_replies;
END $$;
