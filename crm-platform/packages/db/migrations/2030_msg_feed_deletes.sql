-- bluegreen-ok: an_base_replies is a TEMP table created and dropped inside an_msg_feed_rebuild_base; no persistent table is dropped and the old slot never sees it.
-- 2030_msg_feed_deletes
-- The message feed rollup only ever added: a message deleted afterwards (by a person, or with its conversation) stayed counted, while the
-- legacy query (FEED_MESSAGES, deleted_at IS NULL) reads the live table. On prod, workspace 15 showed 3,072 against 2,867 after the
-- conversations of a demo workspace were deleted. This migration makes the stream subtract what the table stops showing:
--   * a message that is deleted for good, or soft-deleted, writes a -1 event at its current status (and +1 when the soft delete is undone);
--   * deleting a conversation writes those -1 events itself (BEFORE DELETE), because by the time the cascade removes the messages the
--     conversation row, and with it the channel, is gone; the message trigger then sees no conversation and writes nothing, so nothing doubles;
--   * the base rebuild (history before the cut-over) leaves out soft-deleted messages, as the legacy query does;
--   * an_msg_feed_reconcile(org) writes the correction for drift already there, and is run once for every workspace at the end.
-- Decision D10 (a deleted message stays counted) is replaced: the rollup must equal the legacy numbers before ANALYTICS_SOURCES moves to it.

CREATE OR REPLACE FUNCTION an_msg_feed_rebuild_base(p_org bigint, p_from timestamptz, p_to timestamptz) RETURNS void
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
   WHERE m.org_id = p_org AND m.created_at >= lo AND m.created_at < hi AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id) AND m.deleted_at IS NULL
   GROUP BY 3, 4, 5, 6;
  INSERT INTO an_rollup_day (org_id, metric, bucket, d1, d2, d3, n)
  SELECT p_org, 6, (m.created_at AT TIME ZONE tz)::date, an_msg_status_code(m.status), COALESCE(c.channel_id, 0),
         an_msg_source_kind(m.direction, m.meta, m.sender_agent_id, m.sender_kind) * 16 + an_msg_kind_class(m.kind), count(*)
    FROM messages m LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
   WHERE m.org_id = p_org AND m.created_at >= lo AND m.created_at < hi AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id) AND m.deleted_at IS NULL
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

-- One -1 event for a message that stops being counted (or +1 when it counts again).
CREATE FUNCTION an_msg_feed_delta(m messages, p_channel bigint, p_qty integer) RETURNS void
  LANGUAGE sql
  AS $$ INSERT INTO an_events (org_id, type, recorded_at, occurred_at, direction, status, source_kind, k1, channel_id, conversation_id, qty)
        VALUES (m.org_id, 7, clock_timestamp(), m.created_at, CASE m.direction WHEN 'in' THEN 1 ELSE 2 END, an_msg_status_code(m.status),
                an_msg_source_kind(m.direction, m.meta, m.sender_agent_id, m.sender_kind), an_msg_kind_class(m.kind), p_channel,
                m.conversation_id, p_qty) $$;

-- AFTER DELETE of a message that is still shown (not soft-deleted) whose conversation still exists.
CREATE FUNCTION an_msg_event_delete() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ch bigint;
  found_conv boolean;
BEGIN
  IF OLD.deleted_at IS NOT NULL OR OLD.created_at < an_msg_feed_cutover()
     OR NOT an_msg_feed_counted(OLD.kind, OLD.meta, OLD.provider_message_id) THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT true, c.channel_id INTO found_conv, ch FROM conversations c WHERE c.org_id = OLD.org_id AND c.id = OLD.conversation_id;
    IF found_conv THEN PERFORM an_msg_feed_delta(OLD, ch, -1); END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'an_events write failed for deleted message % (%): %', OLD.id, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END $$;

-- BEFORE DELETE of a conversation: its messages go with it, so they leave the count here, while the channel can still be read.
CREATE FUNCTION an_conversation_feed_delete() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  m messages;
BEGIN
  BEGIN
    FOR m IN SELECT * FROM messages x WHERE x.org_id = OLD.org_id AND x.conversation_id = OLD.id
                AND x.deleted_at IS NULL AND x.created_at >= an_msg_feed_cutover()
                AND an_msg_feed_counted(x.kind, x.meta, x.provider_message_id)
    LOOP
      PERFORM an_msg_feed_delta(m, OLD.channel_id, -1);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'an_events write failed for deleted conversation % (%): %', OLD.id, SQLSTATE, SQLERRM;
  END;
  RETURN OLD;
END $$;

-- AFTER UPDATE OF deleted_at: a soft delete takes the message out of the count, undoing it puts it back.
CREATE FUNCTION an_msg_event_soft_delete() RETURNS trigger
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
    PERFORM an_msg_feed_delta(NEW, ch, CASE WHEN NEW.deleted_at IS NOT NULL THEN -1 ELSE 1 END);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'an_events write failed for message % (%): %', NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_messages_feed_delete AFTER DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION an_msg_event_delete();
CREATE TRIGGER trg_conversations_feed_delete BEFORE DELETE ON conversations
  FOR EACH ROW EXECUTE FUNCTION an_conversation_feed_delete();
CREATE TRIGGER trg_messages_feed_soft_delete AFTER UPDATE OF deleted_at ON messages
  FOR EACH ROW WHEN ((OLD.deleted_at IS NULL) IS DISTINCT FROM (NEW.deleted_at IS NULL)) EXECUTE FUNCTION an_msg_event_soft_delete();

-- Writes, for one workspace, the events that bring the stream (messages at or after the cut-over) in line with what `messages` holds now.
-- One correction per hour/status/channel/class cell that differs; run twice it writes nothing the second time. Returns the cells corrected.
CREATE FUNCTION an_msg_feed_reconcile(p_org bigint) RETURNS integer
  LANGUAGE plpgsql
  AS $$
DECLARE
  tz text;
  cutoff timestamptz := an_msg_feed_cutover();
  n integer;
BEGIN
  SELECT COALESCE((SELECT z.name FROM workspace_settings ws JOIN pg_timezone_names z ON z.name = ws.timezone WHERE ws.org_id = p_org), 'UTC') INTO tz;
  WITH truth AS (
    SELECT date_trunc('hour', m.created_at AT TIME ZONE tz) AT TIME ZONE tz AS b, an_msg_status_code(m.status)::int AS s, COALESCE(c.channel_id, 0) AS ch,
           an_msg_source_kind(m.direction, m.meta, m.sender_agent_id, m.sender_kind) * 16 + an_msg_kind_class(m.kind) AS fc, count(*) AS q
      FROM messages m LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
     WHERE m.org_id = p_org AND m.created_at >= cutoff AND m.deleted_at IS NULL AND an_msg_feed_counted(m.kind, m.meta, m.provider_message_id)
     GROUP BY 1, 2, 3, 4
  ), have AS (
    SELECT date_trunc('hour', e.occurred_at AT TIME ZONE tz) AT TIME ZONE tz AS b, x.s, COALESCE(e.channel_id, 0) AS ch,
           e.source_kind * 16 + e.k1 AS fc, sum(x.q) AS q
      FROM an_events e CROSS JOIN LATERAL (VALUES (e.status::int, e.qty::bigint), (e.k2::int, -e.qty::bigint)) AS x(s, q)
     WHERE e.org_id = p_org AND e.type = 7 AND e.occurred_at >= cutoff AND x.s IS NOT NULL
     GROUP BY 1, 2, 3, 4
  ), delta AS (
    SELECT COALESCE(t.b, h.b) AS b, COALESCE(t.s, h.s) AS s, COALESCE(t.ch, h.ch) AS ch, COALESCE(t.fc, h.fc) AS fc,
           COALESCE(t.q, 0) - COALESCE(h.q, 0) AS d
      FROM truth t FULL JOIN have h ON h.b = t.b AND h.s = t.s AND h.ch = t.ch AND h.fc = t.fc
  )
  INSERT INTO an_events (org_id, type, recorded_at, occurred_at, direction, status, source_kind, k1, channel_id, qty)
  SELECT p_org, 7, clock_timestamp(), b, CASE WHEN s = 6 THEN 1 ELSE 2 END, s, fc / 16, fc % 16, NULLIF(ch, 0), d FROM delta WHERE d <> 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- An operator tool, not an app one: the app role must not write corrections for a workspace it is not in.
REVOKE EXECUTE ON FUNCTION an_msg_feed_reconcile(bigint) FROM PUBLIC;

-- One run for every workspace now; the rollup worker folds the corrections in on its next pass.
DO $$
DECLARE o bigint;
BEGIN
  FOR o IN SELECT DISTINCT org_id FROM an_events WHERE type = 7 LOOP
    PERFORM an_msg_feed_reconcile(o);
  END LOOP;
END $$;
