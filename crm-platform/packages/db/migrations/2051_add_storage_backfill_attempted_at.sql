-- 2051_add_storage_backfill_attempted_at
-- Why (legacy issue #1524): the backfill picks up the three lowest-id workspaces that are not yet backfilled. A workspace whose
-- size probe keeps failing is deferred but never marked, so it keeps its slot and later workspaces never start. The pick-up needs
-- to know when a workspace was last tried, so the least recently attempted go first.
--
-- Expand-only: one nullable column, no default and no rewrite of existing rows. A workspace with NULL has never been attempted.
ALTER TABLE storage_org_state
  ADD COLUMN backfill_attempted_at timestamptz;
