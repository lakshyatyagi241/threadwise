-- fb: capability keys for the Facebook Pages channel.
-- Why this migration exists (WD-FB-022): WaDesk gated the Facebook routes on the workspace role and the plan flags `access_facebook`
-- and `facebook_posts`. Here the Page connection (the most sensitive credential), broadcasts, Messenger setup, posts and insights
-- are separate keys so a workspace can hand them out apart.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('fb.pages.read',        'View Facebook Pages',                 'facebook', false),
  ('fb.pages.manage',      'Connect and manage Facebook Pages',   'facebook', false),
  ('fb.broadcasts.read',   'View Messenger broadcasts',           'facebook', false),
  ('fb.broadcasts.manage', 'Create and run Messenger broadcasts', 'facebook', false),
  ('fb.setup.manage',      'Edit the Messenger profile',          'facebook', false),
  ('fb.posts.read',        'View Facebook posts',                 'facebook', false),
  ('fb.posts.manage',      'Compose, schedule and delete Facebook posts', 'facebook', false),
  ('fb.insights.read',     'View Facebook Page insights',         'facebook', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new
-- keys by unlocking, granting and relocking here. New organizations get every key in permission_defs when provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('fb.pages.read'),
    ('fb.pages.manage'),
    ('fb.broadcasts.read'),
    ('fb.broadcasts.manage'),
    ('fb.setup.manage'),
    ('fb.posts.read'),
    ('fb.posts.manage'),
    ('fb.insights.read')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
