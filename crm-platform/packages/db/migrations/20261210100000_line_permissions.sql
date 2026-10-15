-- line: capability keys for the LINE channel.
-- Why this migration exists: Reference gated /line on a workspace-role check and the plan flags `access_line` and
-- `line_broadcasts`. Here the channel screens, channel management (credentials, token rotation), broadcasts and their
-- management are separate keys so a workspace can hand them out apart.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('line.channels.read',     'View LINE channels',               'line', false),
  ('line.channels.manage',   'Connect and manage LINE channels', 'line', false),
  ('line.broadcasts.read',   'View LINE broadcasts',             'line', false),
  ('line.broadcasts.manage', 'Create and run LINE broadcasts',   'line', false)
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
    ('line.channels.read'),
    ('line.channels.manage'),
    ('line.broadcasts.read'),
    ('line.broadcasts.manage')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
