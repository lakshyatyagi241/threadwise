-- @no-transaction
-- notif: "was this waiting episode already nudged?" in one index probe (BL-098).
-- Why this migration exists: the sweep must not nudge a chat twice in one waiting episode, so for each candidate chat it asks whether a
-- `chat_waiting` row about that conversation exists since the wait began. The only existing index on the type is (org_id, type), which
-- would scan every nudge a workspace ever got. This partial index is keyed by the conversation and holds only nudge rows.
-- CONCURRENTLY, one statement, outside a transaction, like its sibling.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inbox_notifications_chat_waiting
  ON inbox_notifications (org_id, subject_uuid, created_at DESC)
  WHERE type = 'chat_waiting';
