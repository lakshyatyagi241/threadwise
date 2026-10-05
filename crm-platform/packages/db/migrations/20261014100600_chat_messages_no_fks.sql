-- chat: the message stream carries no foreign keys.
-- Why this migration exists: 20261014100100_chat_messages_fold gave `messages` four composite foreign keys (thread, sender user, sender
-- AI agent, template). The repository rule is that a partitioned stream has none (schema-invariants.spec.ts: they cost throughput on the
-- hottest table and make partition maintenance harder), so they are dropped here instead of editing an applied migration.
--
-- What is kept without them:
--   * Tenant safety: RLS `WITH CHECK` pins `org_id`, and every writer takes the conversation id from the thread it has just locked in its
--     own tenant transaction. A message can only be read through a thread of the same workspace.
--   * "Deleting a thread deletes its messages", the one thing the cascade did that nothing else does: the trigger below.
--   * `sender_user_id`, `sender_agent_id` and `template_id` become plain references: a removed user, AI agent or template leaves the id
--     behind and readers show no name (`message.sender.name` is nullable on the wire).
-- The ledger keeps its own cascading foreign key to the thread (it is a plain table, not a stream).
ALTER TABLE messages DROP CONSTRAINT fk_messages_conversation_id;
ALTER TABLE messages DROP CONSTRAINT fk_messages_sender_user_id;
ALTER TABLE messages DROP CONSTRAINT fk_messages_sender_agent_id;
ALTER TABLE messages DROP CONSTRAINT fk_messages_template_id;

-- Runs before the thread row is deleted, inside the deleting transaction; `idx_messages_thread` serves it.
CREATE OR REPLACE FUNCTION chat_delete_thread_messages() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM messages WHERE org_id = OLD.org_id AND conversation_id = OLD.id;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_conversations_delete_messages BEFORE DELETE ON conversations
  FOR EACH ROW EXECUTE FUNCTION chat_delete_thread_messages();
