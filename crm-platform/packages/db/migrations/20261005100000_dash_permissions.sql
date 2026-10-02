-- dash: capability keys for the workspace dashboard and analytics.
-- Why this migration exists (WD-DASH-001, 022): WaDesk gated both pages on "workspace role manager or above". Here that is two
-- capabilities a workspace can hand to any role. The dashboard shows workspace-wide message counts, so it is not given to the
-- front-line preset; analytics additionally needs the plan's `analytics` feature (checked in the API, not here).
-- The domain owns no table, so there is nothing else to create and no RLS to add.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('dash.dashboard.read', 'View the workspace dashboard', 'dashboard', false),
  ('dash.analytics.read', 'View workspace analytics',     'dashboard', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role): unlock, grant, relock, as the deals migration does.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES ('dash.dashboard.read'), ('dash.analytics.read')) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
