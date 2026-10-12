-- workspace lifecycle: the operator keys (see 20261116090000_org_lifecycle.sql).
--
--   platform.workspace.retention   change a workspace's archive/delete timings, mark it never-delete (or clear that), restore an archived one
--   platform.workspace.legal_hold  place or release a legal hold. A hold blocks archive and erase and never lapses on its own, so it is a
--                                  decision of its own, given to the Super Admin only.
-- Reading the lifecycle needs the existing `platform.workspace.view_all`.
INSERT INTO platform_permissions (name, is_system) VALUES
  ('platform.workspace.retention', true),
  ('platform.workspace.legal_hold', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM platform_roles r JOIN platform_permissions p ON p.name::text = 'platform.workspace.retention'
WHERE r.name IN ('Super Admin', 'Admin')
ON CONFLICT DO NOTHING;

INSERT INTO platform_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM platform_roles r JOIN platform_permissions p ON p.name::text = 'platform.workspace.legal_hold'
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;

-- The cached per-operator permission sets are keyed by this version.
UPDATE platform_settings SET value = to_jsonb(coalesce((value #>> '{}')::int, 0) + 1) WHERE key = 'rbac.version';
