-- rbac: keys every member of a workspace holds by default, and the place a domain declares them.
-- Why this migration exists: "everything is manageable through permissions". Filing and reading your own support tickets was open to any
-- signed-in user with no key at all (Reference parity), so a workspace could not switch it off for a role. It now has keys, and every preset
-- gets them, so nothing changes until an Owner or Admin edits a role.
--
-- `workspace_preset_baseline` is the extension point: a domain that adds a key every preset should hold inserts rows here instead of editing
-- the preset function. `apply_workspace_preset_baseline` grants them to one organization's presets; provisioning calls it after the presets.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('support.ticket.create', 'File support tickets with the platform team', 'support', false),
  ('support.ticket.read',   'View and reply to your own support tickets',  'support', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

CREATE TABLE workspace_preset_baseline (
  preset_key     text NOT NULL CHECK (preset_key IN ('admin', 'workspace_admin', 'manager', 'agent', 'viewer')),
  permission_key text NOT NULL REFERENCES permission_defs (key) ON DELETE CASCADE,
  record_scope   record_scope NOT NULL DEFAULT 'all',
  PRIMARY KEY (preset_key, permission_key)
);
COMMENT ON TABLE workspace_preset_baseline IS
  'Global (no org_id, no RLS): grants every organization''s preset roles receive at provisioning. preset_key is roles.system_key.';
GRANT SELECT ON workspace_preset_baseline TO crm_app, crm_worker;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin'), ('manager'), ('agent'), ('viewer')) AS p(preset)
CROSS JOIN (VALUES ('support.ticket.create'), ('support.ticket.read')) AS k(key);

CREATE OR REPLACE FUNCTION apply_workspace_preset_baseline(p_org bigint) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  prev_priv text := current_setting('app.privileged', true);
BEGIN
  PERFORM set_config('app.privileged', 'on', true);
  PERFORM set_config('app.rbac_preset_sync', 'on', true);
  INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
    SELECT p_org, r.id, b.permission_key, 'allow', b.record_scope
    FROM workspace_preset_baseline b
    JOIN roles r ON r.org_id = p_org AND r.system_key = b.preset_key
  ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
  PERFORM set_config('app.rbac_preset_sync', 'off', true);
  PERFORM set_config('app.privileged', coalesce(prev_priv, 'off'), true);
END $$;

-- Provisioning = the presets, then their baseline. The previous function keeps its body under a new name.
ALTER FUNCTION provision_workspace_presets(bigint) RENAME TO provision_workspace_presets_core;
CREATE OR REPLACE FUNCTION provision_workspace_presets(p_org bigint) RETURNS bigint
  LANGUAGE plpgsql AS $$
DECLARE
  owner_id bigint;
BEGIN
  owner_id := provision_workspace_presets_core(p_org);
  PERFORM apply_workspace_preset_baseline(p_org);
  RETURN owner_id;
END $$;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
