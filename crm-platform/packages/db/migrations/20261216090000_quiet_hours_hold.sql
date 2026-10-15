-- BL-177: quiet hours and calling windows are enforced by DEFERRING a marketing send, never by denying it.
--
-- A send held for the workspace's quiet hours needs somewhere to say so. No new table: the three recipient tables of the bulk senders
-- get the instant the recipient may be messaged and why, so the counters can say "held" and a screen can show the reason. A chat
-- message keeps its hold in `messages.meta.hold`; the only thing it needs from the schema is the `held` event in its log.
-- Additive: every column is nullable, nothing is rewritten, the old code ignores them. RLS is unchanged (these tables already have
-- it forced).

-- 1. The message event log gets a `held` event (the chat dispatcher met the quiet hours and delayed the job).
ALTER TABLE message_events DROP CONSTRAINT chk_message_events_event;
ALTER TABLE message_events ADD CONSTRAINT chk_message_events_event
  CHECK (event IN ('queued', 'attempt', 'retry', 'held', 'sent', 'delivered', 'read', 'failed'));

-- 2. Broadcast recipients. A held recipient stays `pending` (it is not sent, not failed, not lost); `held_until` is when the run may
--    take it, `held_reason` is why (`quiet_hours`).
ALTER TABLE broadcast_contacts
  ADD COLUMN held_until  timestamptz,
  ADD COLUMN held_reason text,
  ADD CONSTRAINT ck_broadcast_contacts_held_reason CHECK (held_reason IS NULL OR held_reason IN ('quiet_hours', 'calling_window'));
CREATE INDEX idx_broadcast_contacts_held ON broadcast_contacts (org_id, broadcast_id, held_until) WHERE held_until IS NOT NULL;

-- 3. Campaign recipients: a held recipient goes back to `queued`; the claim skips it until `held_until`.
ALTER TABLE wp_campaign_contacts
  ADD COLUMN held_until  timestamptz,
  ADD COLUMN held_reason text,
  ADD CONSTRAINT ck_wp_campaign_contacts_held_reason CHECK (held_reason IS NULL OR held_reason IN ('quiet_hours', 'calling_window'));
CREATE INDEX idx_wp_campaign_contacts_held ON wp_campaign_contacts (org_id, campaign_id, held_until) WHERE held_until IS NOT NULL;

-- 4. Scheduled-message recipients: a held recipient stays `pending`; the run pauses until the earliest `held_until`.
ALTER TABLE scheduled_message_contacts
  ADD COLUMN held_until  timestamptz,
  ADD COLUMN held_reason text,
  ADD CONSTRAINT ck_scheduled_message_contacts_held_reason CHECK (held_reason IS NULL OR held_reason IN ('quiet_hours', 'calling_window'));
CREATE INDEX idx_scheduled_message_contacts_held ON scheduled_message_contacts (org_id, scheduled_message_id, held_until) WHERE held_until IS NOT NULL;
