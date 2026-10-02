-- plan: data retention (WD-PLAN-023) and nothing else that needs a new table (the delete-proof quota ledger, WD-PLAN-018, is the
-- existing `plan_usage` table).
-- Why this migration exists: WaDesk's packages carry `data_retention_days` (0 = never wipe) and stamp `workspaces.data_wiped_at` once a
-- lapsed workspace has been cleaned. Here the first is a column on the plan row, the second a column of the workspace's plan state.
-- A plan carries the number, a workspace carries the stamp; the stamp is what makes the sweep run at most once per workspace.

ALTER TABLE plans
  ADD COLUMN data_retention_days integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT chk_plans_retention CHECK (data_retention_days BETWEEN 0 AND 3650);

ALTER TABLE org_plan_state ADD COLUMN data_wiped_at timestamptz;

-- The sweep looks for lapsed paid workspaces that were not wiped yet; a partial index keeps that scan small.
CREATE INDEX idx_org_plan_state_wipe_candidates ON org_plan_state (plan_ends_at)
  WHERE data_wiped_at IS NULL AND plan_ends_at IS NOT NULL;
