-- unofficial WhatsApp engine: the per-workspace allow-list.
-- Why this migration exists: owner decision 2026-10-06. The unofficial engine (personal numbers over Baileys, channel kind
-- `whatsapp_qr`, `devices`, the node bridge) must not be open to every workspace. The platform switch
-- (`platform_settings` key `wa.unofficial.enabled`) stays as the GLOBAL kill-switch; a workspace may use the engine only when that
-- switch is ON and the workspace has a row here. No row means off, so every workspace (new sign-ups and platform-owned ones
-- included) starts off, and this migration inserts nothing.
--
-- Only a platform super admin writes it (the operator console, through the privileged flag). A tenant transaction may read its own
-- row, so a guard or a worker running in a workspace context can ask "am I allowed" without the privileged flag, and it can never
-- see another workspace's row or write its own entitlement.

CREATE TABLE unofficial_whatsapp_workspaces (
  org_id                  bigint PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  enabled_at              timestamptz NOT NULL DEFAULT now(),
  -- The platform operator who allowed it. A plain id, no FK, like platform_settings.updated_by: the record outlives the operator.
  enabled_by_operator_id  bigint,
  note                    text NOT NULL DEFAULT '',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  row_version             integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_unofficial_wa_workspaces_note CHECK (char_length(note) <= 500)
);

CREATE TRIGGER trg_unofficial_whatsapp_workspaces_touch BEFORE UPDATE ON unofficial_whatsapp_workspaces
  FOR EACH ROW EXECUTE FUNCTION touch_row();

ALTER TABLE unofficial_whatsapp_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE unofficial_whatsapp_workspaces FORCE  ROW LEVEL SECURITY;
-- One policy per command: the tenant read must not open the write side.
CREATE POLICY tenant_read ON unofficial_whatsapp_workspaces FOR SELECT
  USING (org_id = current_org_id() OR app_is_privileged());
CREATE POLICY operator_insert ON unofficial_whatsapp_workspaces FOR INSERT WITH CHECK (app_is_privileged());
CREATE POLICY operator_update ON unofficial_whatsapp_workspaces FOR UPDATE
  USING (app_is_privileged()) WITH CHECK (app_is_privileged());
CREATE POLICY operator_delete ON unofficial_whatsapp_workspaces FOR DELETE USING (app_is_privileged());
GRANT SELECT, INSERT, UPDATE, DELETE ON unofficial_whatsapp_workspaces TO crm_app, crm_worker;
