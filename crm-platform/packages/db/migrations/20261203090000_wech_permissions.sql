-- wech: capability keys for the WeChat channel.
-- Why this migration exists: Reference gated /wechat on the plan flag `access_wechat` and /wechat/broadcasts on `wechat_broadcasts`, with
-- no role check of its own. Here connecting and managing an Official Account and the mass-send broadcasts are separate read and manage
-- keys, so a workspace can hand them out apart (the AppSecret is the most sensitive credential the screens touch).

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('wechat.channels.read',     'View WeChat channels',                   'wechat', false),
  ('wechat.channels.manage',   'Connect and manage WeChat channels',     'wechat', false),
  ('wechat.broadcasts.read',   'View WeChat broadcasts',                 'wechat', false),
  ('wechat.broadcasts.manage', 'Create and send WeChat broadcasts',      'wechat', false)
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
    ('wechat.channels.read'),
    ('wechat.channels.manage'),
    ('wechat.broadcasts.read'),
    ('wechat.broadcasts.manage')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
