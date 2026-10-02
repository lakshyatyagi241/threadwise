-- tg: capability keys for the Telegram channel.
-- Why this migration exists (WD-TG-001, 002, 007): WaDesk gated /telegram on a workspace-role check and the plan flags
-- `access_telegram` and `telegram_broadcasts`. Here the bot screens, bot management, broadcasts and the Telegram user
-- account (the most sensitive credential) are separate keys so a workspace can hand them out apart.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('tg.bots.read',          'View Telegram bots',            'telegram', false),
  ('tg.bots.manage',        'Connect and manage Telegram bots', 'telegram', false),
  ('tg.broadcasts.read',    'View Telegram broadcasts',      'telegram', false),
  ('tg.broadcasts.manage',  'Create and run Telegram broadcasts', 'telegram', false),
  ('tg.accounts.manage',    'Manage the Telegram user account', 'telegram', false)
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
    ('tg.bots.read'),
    ('tg.bots.manage'),
    ('tg.broadcasts.read'),
    ('tg.broadcasts.manage'),
    ('tg.accounts.manage')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
