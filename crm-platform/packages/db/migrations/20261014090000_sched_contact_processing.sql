-- sched: a scheduled recipient can be "processing" while a send is in flight
-- Why this migration exists: the run claims a recipient (pending -> processing) before it calls the provider, so a retry after
-- a crash never sends the same person twice. Reference's bridge had no such step: a restart mid-run sent again. Same idea as
-- broadcast_contacts. The ranks of the other states (pending, failed, sent, delivered, read) are unchanged.

ALTER TABLE scheduled_message_contacts DROP CONSTRAINT chk_scheduled_message_contacts_status;
ALTER TABLE scheduled_message_contacts ADD CONSTRAINT chk_scheduled_message_contacts_status
  CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'read', 'failed'));
