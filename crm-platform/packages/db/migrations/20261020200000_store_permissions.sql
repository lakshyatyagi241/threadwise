-- store: capability keys for the store dashboard, the shop wizard and the storefront settings.
-- Why this migration exists (WD-STORE-001, 024): WaDesk put every /store route behind the workspace "admin" role and nothing
-- finer. Here each area has a key (a role can be given the dashboard without the settings), and the locked Admin preset, which
-- is the WaDesk workspace admin, gets all of them, so a WaDesk admin loses nothing. Workspace-level toggles: no record scope.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('store.dashboard.read',    'View the store dashboard',                       'store', false),
  ('store.shops.manage',      'Create, edit, delete and reset shops',           'store', false),
  ('store.storefront.read',   'View storefront settings',                       'store', false),
  ('store.storefront.manage', 'Edit storefront settings and verify the domain', 'store', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new keys
-- by unlocking, granting and relocking here, as the tasks and deals migrations do.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('store.dashboard.read'), ('store.shops.manage'), ('store.storefront.read'), ('store.storefront.manage')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
