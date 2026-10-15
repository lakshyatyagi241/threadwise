-- @no-transaction
-- crm-dashboard: the "recent activity" feed and the per-person activity counts read deal_activities by time inside one workspace
-- ("newest N rows, joined to the deals the caller may see"). The only index on the table starts with (org_id, deal_id, ...), so the
-- planner scanned and sorted every row of the workspace (EXPLAIN on 150k rows: parallel seq scan plus a 4 MB external merge sort for a
-- LIMIT 10). With (org_id, created_at DESC) it walks the newest rows and stops at ten. CONCURRENTLY so building it does not block
-- writes on a live table, and alone in its file because CONCURRENTLY refuses to share a transaction with anything else.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deal_activities_org_created
  ON deal_activities (org_id, created_at DESC, id DESC);
