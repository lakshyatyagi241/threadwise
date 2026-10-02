-- tib1: make `conversation_events` readable as a timeline (plan-inbox-chat.md sections 3.3 and 4.2, route GET /inbox/conversations/:id/events).
-- Why this migration exists: the table is a literal copy of Reference's log, which only the page that wrote it ever read, so a row had no id a
-- client could name. The timeline needs one (the id on the wire is a uuid, never the bigint), and it needs to be paged newest first
-- inside one conversation without scanning the workspace's whole log.
--
-- `actor_type` was free text in Reference (`user`, `human`, `flow`, `system`); the contract lists the five kinds a timeline can show, and a
-- CHECK keeps a writer from inventing a sixth that no screen knows how to draw. Reference's `human` is `user` here. No rows exist yet (nothing
-- wrote the table), so nothing is rewritten.
--
-- The table is a monthly partitioned stream: an ADD COLUMN on the parent reaches every partition, and the CHECK and the index are
-- created on the parent and propagate to the monthly partitions and to the default one.

SELECT set_config('app.privileged', 'on', true);

ALTER TABLE conversation_events ADD COLUMN uuid uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE conversation_events
  ADD CONSTRAINT chk_conversation_events_actor_type CHECK (actor_type IN ('user', 'system', 'bot', 'flow', 'ai'));

-- Newest first inside one conversation, with the id as the tie-break so a keyset cursor is stable.
CREATE INDEX idx_conversation_events_timeline ON conversation_events (org_id, conversation_id, created_at DESC, id DESC);
