-- flb: a workspace can pick its own flow builder.
-- Why this migration exists: the platform admin sets the default builder (Simple step-by-step or Advanced canvas) for every
-- workspace, and a workspace may override it. NULL means "follow the platform default", so no backfill is needed and a workspace
-- that never chose keeps following whatever the admin sets. The column sits on the existing workspace_settings row (its RLS and
-- touch trigger already apply); no new table.

ALTER TABLE workspace_settings
  ADD COLUMN flow_builder_mode text,
  ADD CONSTRAINT chk_workspace_settings_flow_builder_mode CHECK (flow_builder_mode IS NULL OR flow_builder_mode IN ('simple', 'advanced'));
