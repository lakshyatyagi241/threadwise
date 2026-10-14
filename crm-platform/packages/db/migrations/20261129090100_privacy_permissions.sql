-- privacy: capability keys for the data-subject rights service (BL-143). Not a reference feature.
--
-- Owner and Admin presets get every new key by the trigger on `permission_defs` (20261013100000). Manager gets the read key here and,
-- through `workspace_preset_baseline`, in every workspace provisioned later. Only Owner/Admin may create, verify, hold or export a
-- request, and only they may erase: erasing a person is irreversible.
--   privacy.requests.read      see the data requests list and a request's detail, proof and SLA
--   privacy.requests.manage    create, verify, reject, put on legal hold, export; change the SLA setting
--   privacy.erase.execute      preview and execute the erasure of a person's data (irreversible)

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('privacy.requests.read',   'View data requests (access, export, erasure)',                    'privacy', false),
  ('privacy.requests.manage', 'Create, verify, hold and export data requests',                  'privacy', false),
  ('privacy.erase.execute',   'Erase a person''s data for a data request (irreversible)',       'privacy', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'privacy.requests.read'
FROM (VALUES ('admin'), ('workspace_admin'), ('manager')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
CROSS JOIN (VALUES ('privacy.requests.manage'), ('privacy.erase.execute')) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
