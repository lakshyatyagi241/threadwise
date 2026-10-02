-- rbac: the AI model picker was open to any signed-in user with no key. It gets `aiadm.models.read`, held by every preset through the
-- baseline table (20261014090000), so a workspace can switch it off for a role.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('aiadm.models.read', 'See the AI models available to the workspace', 'ai', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'aiadm.models.read'
FROM (VALUES ('admin'), ('workspace_admin'), ('manager'), ('agent'), ('viewer')) AS p(preset)
ON CONFLICT DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
