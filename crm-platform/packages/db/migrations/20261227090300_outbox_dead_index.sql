-- Index for the dead-letter count the worker heartbeat publishes (ASYNC-048/050).
--
-- Why. Outbox events that run out of retries move to status 'dead' and wait for a replay. The heartbeat now counts them every beat so an
-- alert can fire on any non-zero value. event_outbox is large and rows stay after they are done, so without a partial index that count
-- would scan the table. Dead rows are rare, so this index stays tiny, the same shape as idx_outbox_pending.

CREATE INDEX IF NOT EXISTS idx_outbox_dead ON event_outbox (created_at)
  WHERE status = 'dead';
