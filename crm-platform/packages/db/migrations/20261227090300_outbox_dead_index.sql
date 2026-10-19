-- Index for the dead-letter count the worker heartbeat publishes (ASYNC-048/050) and for listing and replaying dead events.
--
-- Why. Outbox events that run out of retries move to status 'dead' and wait for a replay. The heartbeat counts them every beat so an
-- alert can fire on any non-zero value. event_outbox is large and rows stay after they are done, so without a partial index that count
-- would scan the table. Dead rows are rare, so this index stays tiny, the same shape as idx_outbox_pending.
--
-- Lock. A plain CREATE INDEX on the partitioned parent holds a SHARE lock on every partition while it scans, which blocks the writes of
-- every request that emits an event, and Postgres refuses CONCURRENTLY on a partitioned parent. So this statement gives up fast instead
-- of stalling writers: it waits at most 3 seconds for the lock and runs at most 30. On a table that is still small it finishes in
-- milliseconds. If it times out, the table is big: run `pnpm --filter @crm/db outbox-dead-index` (builds the index partition by
-- partition with CREATE INDEX CONCURRENTLY, no write lock), then run the migrations again; this statement is then a no-op.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE INDEX IF NOT EXISTS idx_outbox_dead ON event_outbox (created_at)
  WHERE status = 'dead';
