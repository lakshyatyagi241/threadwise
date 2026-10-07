-- notif: find the newest row of a collapse key quickly (BL-096 phase 1).
-- Why this migration exists: a collapsing row is replaced by a fresh one on every new message, so the outbox event that produced the
-- NEWEST row of a key (its dedupe key ends in the event id) is how a redelivered, older event is recognised as already counted without
-- double counting. That lookup is "the latest row for (org, user, collapse_key)", which would otherwise scan the person's whole feed
-- (the feed index is keyed by id only). A separate migration from 20261106090000 because that one was already applied.
CREATE INDEX idx_inbox_notifications_collapse_latest
  ON inbox_notifications (org_id, user_id, collapse_key, id DESC)
  WHERE collapse_key IS NOT NULL;
