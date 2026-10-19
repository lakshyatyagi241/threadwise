-- persona profiles: the platform operator's keys (docs/specs/persona-profiles.md section 5.4; schema in 20261230090000).
-- Why this migration exists: the console that manages personas (phase 2) and a workspace's overrides (phase 3) is guarded by platform
-- permission keys, and new platform keys arrive by migration. They are seeded now so the roles can be reviewed before any route uses them.
--
--   platform.persona.view      read the catalog, drafts and a workspace's Persona tab
--   platform.persona.manage    create and edit drafts, duplicate, preview
--   platform.persona.publish   publish, archive, roll back
--   platform.persona.override  edit a workspace's operator overrides, switch its persona, pin or unpin
--
-- None of them grants entitlement: a persona never unlocks a plan feature or an app (spec 9.1). There is deliberately NO new workspace
-- (tenant) key: a workspace edits its own persona with the existing `admin.settings.manage`, because a new tenant key would not be known
-- to `provision_workspace_presets` for workspaces created later (the recorded gap of the Forms, Email templates and Companies wiring).
SELECT set_config('app.privileged', 'on', true);

INSERT INTO platform_permissions (name, is_system) VALUES
  ('platform.persona.view',     true),
  ('platform.persona.manage',   true),
  ('platform.persona.publish',  true),
  ('platform.persona.override', true)
ON CONFLICT (name) DO NOTHING;

-- Super Admin and Admin hold all four; Platform Support only reads.
INSERT INTO platform_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM platform_roles r JOIN platform_permissions p ON p.name::text LIKE 'platform.persona.%'
WHERE r.name IN ('Super Admin', 'Admin')
ON CONFLICT DO NOTHING;

INSERT INTO platform_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM platform_roles r JOIN platform_permissions p ON p.name::text = 'platform.persona.view'
WHERE r.name = 'Platform Support'
ON CONFLICT DO NOTHING;

-- The cached per-operator permission sets are keyed by this version.
UPDATE platform_settings SET value = to_jsonb(coalesce((value #>> '{}')::int, 0) + 1) WHERE key = 'rbac.version';
