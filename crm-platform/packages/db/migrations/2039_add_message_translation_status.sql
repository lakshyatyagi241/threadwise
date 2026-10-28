-- 2039_add_message_translation_status
-- Why this migration exists (not what it does — the SQL says that):
--
-- When an outbound translation fails, the agent's text is sent as typed. The row must say so, or the agent has no way
-- to tell that the customer received the original language (#1278). Additive and nullable: existing rows keep NULL,
-- which means "no translation problem", so nothing is backfilled.

ALTER TABLE messages ADD COLUMN translation_status text;

ALTER TABLE messages ADD CONSTRAINT messages_translation_status_check
  CHECK (translation_status IS NULL OR translation_status IN ('skipped_failed'));
