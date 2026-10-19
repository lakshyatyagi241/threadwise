-- compliance center: capability keys. Not a reference feature.
--
-- Owner and Admin presets get every new key by the trigger on `permission_defs` (20261013100000). Manager gets the read key here and, through
-- `workspace_preset_baseline`, in every workspace provisioned later. Only Owner/Admin may change the compliance settings: they decide who is
-- named as the privacy officer, which profiles are on and what the public page shows.
--   settings.compliance.read    open the Compliance center and its checklist (read-only)
--   settings.compliance.manage  change the profiles, officer contacts, links, quiet hours, sub-processor list and the public page switch

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('settings.compliance.read',   'View the Compliance center and its checklist',                               'settings', false),
  ('settings.compliance.manage', 'Manage regime profiles, officer contacts, links and the sub-processor list', 'settings', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'settings.compliance.read'
FROM (VALUES ('admin'), ('workspace_admin'), ('manager')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'settings.compliance.manage'
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
