-- chat: tie conversations and the ledger to the channel registry.
-- Why this migration exists: `conversations.channel_id` and `message_ledger.channel_id` (earlier migrations of this block) point at the
-- `channels` table, which the channel registry creates in its own migration (*_chat_channels). A thread of one workspace must never
-- point at another workspace's channel, hence the composite key. Deleting a channel that still has threads is refused (RESTRICT): the
-- API only removes a channel without messages, and silently orphaning history is the wrong default.
DO $$
BEGIN
  IF to_regclass('public.channels') IS NULL THEN
    RAISE EXCEPTION 'the channels table does not exist: apply the channel registry migration (*_chat_channels) first';
  END IF;
END $$;

ALTER TABLE conversations
  ADD CONSTRAINT fk_conversations_channel_id FOREIGN KEY (org_id, channel_id) REFERENCES channels (org_id, id) ON DELETE RESTRICT;
ALTER TABLE message_ledger
  ADD CONSTRAINT fk_message_ledger_channel_id FOREIGN KEY (org_id, channel_id) REFERENCES channels (org_id, id) ON DELETE CASCADE;
