-- CRM dashboard: a key for the CRM home entry in the sidebar (Sales group).
-- Why this migration exists: the entry was gated on record.deals.read alone, and a workspace migrated from Waboo keeps deals (its old
-- Sales Pipeline), so it saw a CRM dashboard its old workspace never had. A key of its own lets the migration deny the entry there,
-- while every role that can read deals today keeps it everywhere else (today's behaviour).
--   dash.crm.read   see the CRM dashboard entry in the sidebar

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('dash.crm.read', 'See the CRM dashboard', 'dashboard', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- the presets that read deals today get it too
INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT b.preset_key, 'dash.crm.read'
FROM workspace_preset_baseline b
WHERE b.permission_key = 'record.deals.read'
ON CONFLICT (preset_key, permission_key) DO NOTHING;

-- `organizations` and `role_grants` are under FORCE ROW LEVEL SECURITY: the statements below need the privileged flag.
SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;

-- every custom role that reads deals today
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
SELECT g.org_id, g.role_id, 'dash.crm.read', g.effect, g.record_scope
FROM role_grants g
JOIN roles r ON r.id = g.role_id AND r.org_id = g.org_id
WHERE g.permission_key = 'record.deals.read'
  AND g.effect = 'allow'
  AND r.system_key IS NULL
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

UPDATE organizations SET roles_version = roles_version + 1;
