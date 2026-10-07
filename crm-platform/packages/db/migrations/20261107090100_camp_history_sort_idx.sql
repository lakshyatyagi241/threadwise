-- @no-transaction
-- camp: index for the History page of the broadcast wizard (a page of past runs, newest first).
-- Why this migration exists: the page sorts a workspace's runs by `coalesce(last_run_at, created_at)` and pages by (that, uuid); without an
-- index every page sorted all of the workspace's campaigns. The partial predicate is the page's own (`status NOT IN ('draft','scheduled')`).
-- CONCURRENTLY, so it does not block writes on a live table; hence outside a transaction and exactly one statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wpcampaigns_history_sort
  ON wpcampaigns (org_id, (coalesce(last_run_at, created_at)) DESC, uuid DESC)
  WHERE status NOT IN ('draft', 'scheduled');
