-- 20261222090000_remove_pending_conversation_status
-- Why this migration exists (not what it does — the SQL says that):
--
-- The inbox status "pending" (waiting on the customer) is removed as a lifecycle status, by the owner's decision. A thread that was
-- pending was still in the Open list, so it becomes open: nothing else changes for it. The CHECK constraint is then tightened so no
-- row can be written with the retired value again.

UPDATE conversations SET status = 'open' WHERE status = 'pending';

ALTER TABLE conversations DROP CONSTRAINT chk_conversations_status;
ALTER TABLE conversations ADD CONSTRAINT chk_conversations_status
  CHECK (status IN ('open', 'snoozed', 'resolved', 'closed', 'spam'));
