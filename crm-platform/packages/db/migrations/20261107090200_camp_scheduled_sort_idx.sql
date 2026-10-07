-- @no-transaction
-- camp: index for the Scheduled page of the broadcast wizard (one-off broadcasts waiting for their time, soonest first).
-- Why this migration exists: the page lists a workspace's wizard campaigns that are `scheduled` ordered by (run_at, uuid); the partial
-- predicate is the page's own, so the index holds only what the page reads. CONCURRENTLY, outside a transaction, one statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wpcampaigns_scheduled_sort
  ON wpcampaigns (org_id, run_at, uuid)
  WHERE wizard IS NOT NULL AND series_id IS NULL AND status = 'scheduled' AND run_at IS NOT NULL;
