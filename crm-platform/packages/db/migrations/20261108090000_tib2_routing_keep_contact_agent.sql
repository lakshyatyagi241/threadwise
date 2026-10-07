-- tib2: the "Keep returning contacts with their agent" switch of Settings > Inbox > Auto-assignment.
-- Why this migration exists: the routing rules themselves need no schema (routing_rules, conditions/actions jsonb, exists since the TIB2
-- baseline), but this one workspace-wide on/off setting has no home: workspace_settings is the per-workspace settings row and had no
-- column for it. Off by default, so nothing changes for a workspace until its admin turns it on. A workspace has no settings row until
-- something writes one; the API upserts it (ON CONFLICT (org_id)).
ALTER TABLE workspace_settings
  ADD COLUMN routing_keep_contact_agent boolean NOT NULL DEFAULT false;
