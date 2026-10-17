-- aicrm: permissions for the AI CRM Copilot (docs/threadwise-port/inventory/ai-copilot-lead-finder.md TW-AICRM-016).
-- `.use` is the chat itself (Reference: workspace.role:manager); `.manage` is the WhatsApp-staff-channel toggle, a
-- separate narrower key since it changes how customer messages are routed workspace-wide (Reference:
-- workspace.role:admin), same split pattern as `wfl.forms.read` vs `.manage`.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('aicrm.copilot.use',    'Chat with the AI CRM Copilot',                 'ai', false),
  ('aicrm.copilot.manage', 'Turn the WhatsApp staff-channel copilot on/off', 'ai', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin'), ('manager')) AS p(preset)
CROSS JOIN (VALUES ('aicrm.copilot.use')) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'aicrm.copilot.manage'
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
