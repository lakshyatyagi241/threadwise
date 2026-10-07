-- notif: live notifications (docs/specs/realtime-notifications.md section 6, BL-096 phase 1).
-- Why this migration exists: new chats, new messages, assignments and mentions now become bell rows, and a burst of messages in one
-- chat must stay ONE row for a person (a count, not a flood). `collapse_key` names that one row (`msg:<conversation uuid>`),
-- `event_count` says how many events it stands for, and `subject_kind` / `subject_uuid` say what the row is about, so opening a
-- conversation can mark its rows read without parsing `link`.
--
-- Every column is nullable or defaulted, so every existing row and every existing writer (tasks, leads, forms, sales docs, wallet)
-- keeps working unchanged. No backfill: old messages do not become bell rows, and the old rows have no subject.
-- No RLS change: the table keeps its forced tenant_isolation policy and the touch_row trigger; indexes inherit them.

ALTER TABLE inbox_notifications
  ADD COLUMN collapse_key  text,
  ADD COLUMN event_count   integer NOT NULL DEFAULT 1,
  ADD COLUMN subject_kind  text,
  ADD COLUMN subject_uuid  uuid;

ALTER TABLE inbox_notifications
  ADD CONSTRAINT chk_inbox_notifications_event_count CHECK (event_count >= 1);

-- One UNREAD collapsed row per person and key: two messages racing for the same (person, chat) cannot both insert; the loser's
-- unique violation is retried by the writer (it then finds and replaces the winner's row).
CREATE UNIQUE INDEX uq_inbox_notifications_collapse
  ON inbox_notifications (org_id, user_id, collapse_key)
  WHERE collapse_key IS NOT NULL AND read_at IS NULL;

-- "Mark everything about this conversation read" (opening the thread) and "what is unread about it" read through this.
CREATE INDEX idx_inbox_notifications_subject_unread
  ON inbox_notifications (org_id, user_id, subject_kind, subject_uuid)
  WHERE read_at IS NULL AND subject_uuid IS NOT NULL;
