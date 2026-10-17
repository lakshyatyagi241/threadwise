-- BL-191: quiet hours on the remaining senders. A marketing message to a person whose local time is inside the workspace's quiet hours is
-- HELD, never denied: the recipient stays `pending` with the instant it may be messaged and why (same two columns the broadcast, campaign and
-- scheduled-message recipients got in 20261216090000). Additive: every column is nullable, nothing is rewritten, the old code ignores them.
-- RLS is unchanged (these tables already have it forced).

-- 1. Recipients of the LINE, Messenger, Telegram and Viber broadcasts.
ALTER TABLE line_broadcast_recipients
  ADD COLUMN held_until  timestamptz,
  ADD COLUMN held_reason text,
  ADD CONSTRAINT ck_line_broadcast_recipients_held_reason CHECK (held_reason IS NULL OR held_reason IN ('quiet_hours', 'calling_window'));
CREATE INDEX idx_line_broadcast_recipients_held ON line_broadcast_recipients (org_id, line_broadcast_id, held_until) WHERE held_until IS NOT NULL;

ALTER TABLE facebook_broadcast_recipients
  ADD COLUMN held_until  timestamptz,
  ADD COLUMN held_reason text,
  ADD CONSTRAINT ck_facebook_broadcast_recipients_held_reason CHECK (held_reason IS NULL OR held_reason IN ('quiet_hours', 'calling_window'));
CREATE INDEX idx_facebook_broadcast_recipients_held ON facebook_broadcast_recipients (org_id, facebook_broadcast_id, held_until) WHERE held_until IS NOT NULL;

ALTER TABLE telegram_broadcast_recipients
  ADD COLUMN held_until  timestamptz,
  ADD COLUMN held_reason text,
  ADD CONSTRAINT ck_telegram_broadcast_recipients_held_reason CHECK (held_reason IS NULL OR held_reason IN ('quiet_hours', 'calling_window'));
CREATE INDEX idx_telegram_broadcast_recipients_held ON telegram_broadcast_recipients (org_id, telegram_broadcast_id, held_until) WHERE held_until IS NOT NULL;

ALTER TABLE viber_broadcast_recipients
  ADD COLUMN held_until  timestamptz,
  ADD COLUMN held_reason text,
  ADD CONSTRAINT ck_viber_broadcast_recipients_held_reason CHECK (held_reason IS NULL OR held_reason IN ('quiet_hours', 'calling_window'));
CREATE INDEX idx_viber_broadcast_recipients_held ON viber_broadcast_recipients (org_id, viber_broadcast_id, held_until) WHERE held_until IS NOT NULL;

-- WeChat sends ONE mass-send call to every follower, a tag or a list, so there is no per-recipient step to hold: the whole broadcast waits,
-- and the hold is kept on the broadcast itself.
ALTER TABLE wechat_broadcasts
  ADD COLUMN held_until  timestamptz,
  ADD COLUMN held_reason text,
  ADD CONSTRAINT ck_wechat_broadcasts_held_reason CHECK (held_reason IS NULL OR held_reason IN ('quiet_hours', 'calling_window'));

-- 2. The broadcast wizard's test sends: a test of a MARKETING template is held like any other marketing message and released at the opening.
ALTER TABLE camp_test_sends DROP CONSTRAINT ck_camp_test_sends_status;
ALTER TABLE camp_test_sends ADD CONSTRAINT ck_camp_test_sends_status CHECK (status IN ('held', 'sent', 'delivered', 'read', 'failed'));
ALTER TABLE camp_test_sends
  ADD COLUMN held_until  timestamptz,
  ADD COLUMN held_reason text,
  ADD CONSTRAINT ck_camp_test_sends_held_reason CHECK (held_reason IS NULL OR held_reason IN ('quiet_hours', 'calling_window'));
