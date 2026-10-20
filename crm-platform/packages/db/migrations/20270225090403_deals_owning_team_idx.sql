-- @no-transaction
-- deals: index for the Team filter and the by-team reports on owning_team_id (BL-382).
-- CONCURRENTLY so it does not block writes on a live table, which is why this file runs outside a transaction and holds exactly one statement.
-- Partial: most records have a team only once teams are in use, and a filter by team never asks for NULL.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_owning_team
  ON deals (org_id, owning_team_id) WHERE owning_team_id IS NOT NULL;
