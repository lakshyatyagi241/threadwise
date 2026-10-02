-- chat: fold WaDesk's two message tables into one `messages` stream (plan-inbox-chat.md section 3.3, owner decision 2).
-- Why this migration exists: WaDesk kept `messages` (Quick Send, broadcasts) and `inbox_messages` (the inbox) side by side, so the
-- outbound mirror, the dedupe scans, analytics and translation each had to know about both. Here a message is a message: one monthly
-- partitioned stream, every row belongs to a conversation, and the columns are the ones the pipeline (ingest, send, receipts) and the
-- thread UI need. Plan-level choices, all recorded in parity/chat-conversations.md:
--   * `seq` orders a thread. It is allocated from `conversations.msg_seq` under the conversation row lock, so it is gap-free per thread;
--     it is not unique-constrained because a partitioned table cannot enforce a key that omits the partition column (the lock does).
--   * `uuid` is the id on the wire. It cannot be unique across partitions either; random v4 makes a collision a non-event, and a lookup
--     by uuid uses the per-partition (org_id, uuid) index.
--   * Idempotency is NOT decided here. The unique key lives in `message_ledger` (next migration), which is not partitioned.
--   * Bodies are plain text under RLS (owner decision 9): WaDesk encrypted them, which made message search impossible.
--   * Foreign keys are composite and tenant-safe. A stream normally carries none, but the thread row is locked on every insert anyway and
--     a cross-tenant message is worse than the extra index probe; deleting a conversation takes its messages with it.
-- Dropped as never read: quality_score, quality_note, voice_transcript*, ai_processed_at, ai_reply_id (WaDesk inventory TIB1-055),
-- scheduled_at (Quick Send), to_number / from_number (the peer is on the conversation; who sent it is `sender_kind`).
--
-- Legacy rows are discarded: both tables are written by nothing but the web chat widget and the broadcast mirror, which move to this
-- shape in the same change, and a legacy row has no channel to attach to (see 20261014100000_chat_conversation_reshape.sql).

SELECT set_config('app.privileged', 'on', true);

DO $$
DECLARE
  n_legacy bigint;
  n_inbox bigint;
BEGIN
  SELECT count(*) INTO n_legacy FROM messages;
  SELECT count(*) INTO n_inbox FROM inbox_messages;
  IF n_legacy + n_inbox > 0 THEN
    RAISE NOTICE 'chat fold: discarding % messages row(s) and % inbox_messages row(s) (development data)', n_legacy, n_inbox;
  END IF;
END $$;

DROP TABLE inbox_messages;
DROP SEQUENCE inbox_messages_id_seq;
DROP TABLE messages;

CREATE TABLE messages (
  id bigint NOT NULL DEFAULT nextval('messages_id_seq'),
  org_id bigint NOT NULL,
  uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id bigint NOT NULL,
  seq bigint NOT NULL,
  direction text NOT NULL,
  kind text NOT NULL DEFAULT 'text',
  -- Who produced it. `customer` is the peer; `agent` a staff user (sender_user_id) ; `bot` an automation or AI agent; `system` a
  -- line the platform wrote into the thread; `broadcast` a campaign send mirrored into the thread.
  sender_kind text NOT NULL,
  sender_user_id bigint,
  sender_agent_id bigint,
  body text,
  -- Media lives in the media store, never in Postgres: the key is stored, never a URL (URLs are minted per request, signed, short-lived).
  media_key text,
  media_mime text,
  media_size bigint,
  media_name text,
  media_sha256 text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  status text NOT NULL,
  failure_code text,
  failure_reason text,
  -- The client's own id for an outbound message (the optimistic bubble is swapped for the stored row by this id).
  client_message_id uuid,
  -- The channel's id for the message, kept on the row for display and support; the unique lookup is the ledger.
  provider_message_id text,
  -- `uuid` of the message this one quotes (not an internal id; nothing joins on it).
  reply_to_message_uuid uuid,
  reaction text,
  starred boolean NOT NULL DEFAULT false,
  pinned boolean NOT NULL DEFAULT false,
  edited_at timestamptz,
  deleted_at timestamptz,
  -- Names kept from WaDesk so the translation shim only changes a table name.
  is_translated boolean NOT NULL DEFAULT false,
  translated_body text,
  detected_language text,
  template_id bigint,
  -- Channel-specific leftovers (template name and buttons, forwarded flag, contact card, interactive reply ...). Not a place to hide
  -- columns a query needs.
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- When the channel says the message happened (inbound) or accepted it (outbound).
  provider_ts timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT chk_messages_direction CHECK (direction IN ('in', 'out')),
  CONSTRAINT chk_messages_kind CHECK (kind IN ('text', 'image', 'video', 'audio', 'voice', 'document', 'sticker', 'location', 'contact', 'template', 'reaction', 'interactive', 'system')),
  CONSTRAINT chk_messages_sender_kind CHECK (sender_kind IN ('customer', 'agent', 'bot', 'system', 'broadcast')),
  CONSTRAINT chk_messages_status CHECK (status IN ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  -- Inbound rows are `received` and nothing else; outbound rows start `queued` and only move forward (the pipeline's rank rule).
  CONSTRAINT chk_messages_direction_status CHECK ((direction = 'in') = (status = 'received')),
  CONSTRAINT chk_messages_seq CHECK (seq > 0),
  CONSTRAINT fk_messages_conversation_id FOREIGN KEY (org_id, conversation_id) REFERENCES conversations (org_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_sender_user_id FOREIGN KEY (org_id, sender_user_id) REFERENCES users (org_id, id) ON DELETE SET NULL (sender_user_id),
  CONSTRAINT fk_messages_sender_agent_id FOREIGN KEY (org_id, sender_agent_id) REFERENCES ai_agents (org_id, id) ON DELETE SET NULL (sender_agent_id),
  CONSTRAINT fk_messages_template_id FOREIGN KEY (org_id, template_id) REFERENCES wa_templates (org_id, id) ON DELETE SET NULL (template_id)
) PARTITION BY RANGE (created_at);

-- The thread, oldest to newest and gap detection (`afterSeq`, `before`).
CREATE INDEX idx_messages_thread ON messages (org_id, conversation_id, seq);
CREATE INDEX idx_messages_uuid ON messages (org_id, uuid);
-- The chat widget's reads (transcript repaint, 4 second history poll, takeover check) are by id, not by seq; this is the index
-- 20261010100200_wgt_inbox_thread_index put on the table that this migration replaces, under the same widget-specific name.
CREATE INDEX idx_messages_wgt_conversation ON messages (org_id, conversation_id, id);
-- Analytics windows (dashboards) and the per-workspace time range; partition pruning does the rest.
CREATE INDEX idx_messages_org_created ON messages (org_id, created_at);
-- Recovery of outbound messages that were queued but never dispatched (a crash between commit and enqueue).
CREATE INDEX idx_messages_queued ON messages (created_at) WHERE status = 'queued';
CREATE INDEX idx_messages_sender_user_id ON messages (org_id, sender_user_id) WHERE sender_user_id IS NOT NULL;
CREATE INDEX idx_messages_template_id ON messages (org_id, template_id) WHERE template_id IS NOT NULL;
-- Message search (ILIKE '%word%'); callers restrict to a set of conversations first. Not CONCURRENTLY: not allowed on a partitioned table.
CREATE INDEX idx_messages_body_trgm ON messages USING gin (body gin_trgm_ops);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());

-- Bootstrap partitions (previous month, current, next two) and a catch-all so a gap in partition maintenance degrades into rows
-- landing in _default instead of failed writes. PartitionMaintenanceService finds the parent by itself.
DO $$
DECLARE
  m date;
BEGIN
  FOR m IN
    SELECT generate_series(date_trunc('month', now() - interval '1 month'),
      date_trunc('month', now() + interval '2 months'), interval '1 month')::date
  LOOP
    PERFORM ensure_monthly_partition('messages', m);
  END LOOP;
END $$;
CREATE TABLE messages_default PARTITION OF messages DEFAULT;
SELECT inherit_partition_rls('messages_default');
GRANT SELECT, INSERT, UPDATE, DELETE ON messages_default TO crm_app, crm_worker;
