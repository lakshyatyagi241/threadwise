-- vib: capability keys for the Viber channel.
-- Why this migration exists (TW-VIB-001, 002, 007): Reference gated /viber on the plan flag `access_viber` and the broadcast screens
-- on `viber_broadcasts`. Here the channel screens, channel management and broadcasts are separate keys so a workspace can hand them
-- out apart. The insights page reads with `viber.channels.read`.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('viber.channels.read',     'View Viber channels',                'viber', false),
  ('viber.channels.manage',   'Connect and manage Viber channels',  'viber', false),
  ('viber.broadcasts.read',   'View Viber broadcasts',              'viber', false),
  ('viber.broadcasts.manage', 'Create and run Viber broadcasts',    'viber', false)
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
    ('viber.channels.read'),
    ('viber.channels.manage'),
    ('viber.broadcasts.read'),
    ('viber.broadcasts.manage')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
