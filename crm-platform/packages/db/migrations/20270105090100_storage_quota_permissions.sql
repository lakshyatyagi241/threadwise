-- storage quota, phase S0: the permission keys (docs/specs/storage-quota-and-archival.md, decision O12).
-- Why this migration exists: new keys arrive by migration, and the roles must be reviewable before any route uses them. In phases S0 and S1
-- only the two PLATFORM keys have a route (the operator's read-only fleet view uses the existing `platform.workspace.view_all`; the actions
-- below arrive with phase S2/S4). The three workspace keys are seeded now so the Settings > Storage screen of phase S2 lands on keys that
-- every workspace, old and new, already has.
--
-- Workspace keys (Owner and Admin by default, like the other keys that decide what the workspace keeps):
--   storage.usage.read       see the meter, the breakdown and the banner
--   storage.files.manage     delete a file from the Storage screen (also needs the owning feature's own delete permission)
--   storage.restore.request  ask for an archived file to be restored (phase S5)
-- Platform keys:
--   platform.workspace.storage        re-run a workspace's reconcile and re-evaluate its cap (Super Admin and Admin)
--   platform.workspace.storage_grant  grant extra space for a limited time with a reason (Super Admin only: it spends the platform's money)

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('storage.usage.read',      'See the workspace storage meter and breakdown',            'storage', false),
  ('storage.files.manage',    'Delete files from the Storage screen to free space',       'storage', false),
  ('storage.restore.request', 'Ask for an archived file (such as a recording) to be restored', 'storage', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
CROSS JOIN (VALUES ('storage.usage.read'), ('storage.files.manage'), ('storage.restore.request')) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

-- `organizations` is under FORCE ROW LEVEL SECURITY, which binds the table owner too: without the privileged flag the two statements below
-- would see no workspace (the sibling permission migrations set it for the same reason).
SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;

-- Platform keys.

INSERT INTO platform_permissions (name, is_system) VALUES
  ('platform.workspace.storage',       true),
  ('platform.workspace.storage_grant', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM platform_roles r JOIN platform_permissions p ON p.name::text = 'platform.workspace.storage'
WHERE r.name IN ('Super Admin', 'Admin')
ON CONFLICT DO NOTHING;

INSERT INTO platform_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM platform_roles r JOIN platform_permissions p ON p.name::text = 'platform.workspace.storage_grant'
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;

-- The cached per-operator permission sets are keyed by this version.
UPDATE platform_settings SET value = to_jsonb(coalesce((value #>> '{}')::int, 0) + 1) WHERE key = 'rbac.version';
