-- @no-transaction
-- crm-dashboard: the same feed reads contact_activities by time inside one workspace; its only index is per contact
-- (org_id, contact_id, occurred_at DESC). See 20261129090000 for the reasoning. Alone in its file because of CONCURRENTLY.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_activities_org_occurred
  ON contact_activities (org_id, occurred_at DESC, id DESC);
