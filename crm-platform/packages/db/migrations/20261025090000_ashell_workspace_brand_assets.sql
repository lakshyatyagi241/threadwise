-- Why: WD-ASHELL-036 lets a workspace owner upload a logo and a favicon for the white-label shell (WD-ASHELL-025). The bytes get their
-- own tenant table (the same interim storage the user avatar uses) so reading the workspace never drags a blob through the buffer cache.
-- One row per slot; replacing a file overwrites the row, which also fixes WaDesk leaving the old file behind.
CREATE TABLE workspace_brand_assets (
  org_id     bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  slot       text NOT NULL,
  mime       text NOT NULL,
  bytes      bytea NOT NULL,
  etag       text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, slot),
  CONSTRAINT chk_workspace_brand_assets_slot CHECK (slot IN ('logo', 'favicon')),
  CONSTRAINT chk_workspace_brand_assets_size CHECK (octet_length(bytes) <= 2097152)
);

ALTER TABLE workspace_brand_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_brand_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_brand_assets FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_brand_assets TO crm_app, crm_worker;
