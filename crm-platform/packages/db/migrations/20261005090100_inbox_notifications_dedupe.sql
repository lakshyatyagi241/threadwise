-- notif: the in-app bell (inbox_notifications) gets an idempotency key and a feed index.
-- Why this migration exists: notifications are written by outbox consumers, and the outbox delivers at least once. `dedupe_key`
-- (the event type plus the outbox event id) lets a consumer insert with ON CONFLICT DO NOTHING so a redelivered event cannot
-- notify twice, while two real events (assigned, unassigned, assigned again) each notify. WaDesk de-duplicated on a 30 s cache
-- key that failed open per node; a unique index does not.
-- The feed index serves "my newest 40" and the badge count (`read_at IS NULL`) for one user.

ALTER TABLE inbox_notifications ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX uq_inbox_notifications_dedupe
  ON inbox_notifications (org_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_inbox_notifications_user_feed
  ON inbox_notifications (org_id, user_id, id DESC);
CREATE INDEX idx_inbox_notifications_user_unread
  ON inbox_notifications (org_id, user_id) WHERE read_at IS NULL;
