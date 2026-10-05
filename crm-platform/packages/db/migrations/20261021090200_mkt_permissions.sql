-- marketplace: capability keys, for workspaces and for the platform operator (spec M-09, section 6.5).
-- Why this migration exists: who in a workspace may browse, install and configure apps is a decision of the workspace's admin
-- (spec user story 6), so the keys are workspace permissions; the platform operator's catalogue work is split into operating the
-- catalogue (listings, categories, hide, kill, requests) and reviewing it (approve, reject, publish), as the platform roles of the
-- WhatsApp provider registry were.
--
--   market.apps.read      browse the Marketplace, see installed apps, ask for an integration and vote
--   market.apps.install   install an app (and consent to its permissions), accept a new version's permissions, uninstall
--   market.apps.manage    configure an installed app, pause and resume it, test its connection, send a sample lead, rotate its secret
--
-- The Admin presets hold all three, as they hold the other settings keys. A workspace changes that in its role editor.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('market.apps.read',    'Browse the Marketplace and see installed apps',                 'marketplace', false),
  ('market.apps.install', 'Install and remove Marketplace apps and integrations',          'marketplace', false),
  ('market.apps.manage',  'Configure, pause and test installed apps and integrations',     'marketplace', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
CROSS JOIN (VALUES ('market.apps.read'), ('market.apps.install'), ('market.apps.manage')) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;

-- Platform permission keys (TW-RBAC: new platform keys arrive by migration), granted to Super Admin and Admin.
INSERT INTO platform_permissions (name, is_system) VALUES
  ('platform.market.manage', true),
  ('platform.market.review', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM platform_roles r JOIN platform_permissions p ON p.name::text LIKE 'platform.market.%'
WHERE r.name IN ('Super Admin', 'Admin')
ON CONFLICT DO NOTHING;

-- The cached per-operator permission sets are keyed by this version.
UPDATE platform_settings SET value = to_jsonb(coalesce((value #>> '{}')::int, 0) + 1) WHERE key = 'rbac.version';
