-- @no-transaction
-- The archived count of the inbox (the Archived row and the badges of the archive view), read from the index alone.
-- Why this migration exists: the archive count is part of the same badge request as the tabs, and without a partial index
-- it scanned every conversation of the workspace to find the archived ones. This index holds only archived threads with a
-- message, which is a small set, and carries the same columns as the live-badges index so the visibility rule reads it too.
-- CONCURRENTLY so the live table is not locked, which is why this file runs outside a transaction and holds exactly one statement.
--
-- Cost: as for 20270323090000 (one table scan, then a wait for older transactions). Measured on 400k threads: about 0.4 s, warm cache.
--
-- Failure: as for 20270323090000. The runner refuses to run this file while the index is INVALID (DROP INDEX CONCURRENTLY, then
-- rerun), and IF NOT EXISTS lets a rerun after a crash before the record skip a VALID index this file built.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_archived_badges
  ON conversations (org_id, channel_id, assignee_user_id, assignee_team_id, unread_count, handling)
  WHERE archived = TRUE AND last_message_at IS NOT NULL;
