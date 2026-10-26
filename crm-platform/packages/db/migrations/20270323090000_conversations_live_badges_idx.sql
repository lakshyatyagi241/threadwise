-- @no-transaction
-- The inbox's tab badges (All, Mine, Unassigned, Unread, Waiting) for the open threads, read from the index alone.
-- Why this migration exists: every list load, socket signal and safety poll asks for these badges, and with status and
-- archive inside the aggregate the query read the whole conversations table (about 290 MB and 1.6 s per request on a
-- 400k-thread workspace). This partial index holds only open, unarchived threads with a message, and carries every column the
-- badges and the visibility rule read, so the count can be an index-only scan (about 15 ms as a superuser). As the app role,
-- with the tenant policy enforced, the same index is read as a bitmap scan (about 25 to 40 ms, measured on 400k threads). CONCURRENTLY so the
-- live table is not locked, which is why this file runs outside a transaction and holds exactly one statement.
--
-- Cost: one scan of the table plus a wait for transactions that started before the build. Measured on 400k threads (373 MB, warm
-- cache): about 0.5 s. A cold cache on a much larger table is slower: the scan reads the whole heap, so budget about a minute per
-- 10 GB of conversations. Long-open transactions delay the second phase; check pg_stat_activity (xact_start) before running it.
--
-- Failure: a failed build leaves the index INVALID, and the planner never uses it. Before the statement the runner refuses while that
-- index is INVALID or still being built, and names the recovery (DROP INDEX CONCURRENTLY, then rerun). IF NOT EXISTS adopts a VALID
-- index only when its definition is this one: a crash after the build but before the record leaves exactly that, and the rerun records
-- the file and goes on. `pnpm db:verify-schema` reports an INVALID index as an error.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_live_badges
  ON conversations (org_id, channel_id, assignee_user_id, assignee_team_id, unread_count, handling)
  WHERE archived = FALSE AND status = 'open' AND last_message_at IS NOT NULL;
