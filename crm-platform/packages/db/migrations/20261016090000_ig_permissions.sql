-- ig: capability keys for the Instagram channel (Instaflow bridge).
-- Why this migration exists (TW-IG-015): Reference gated the Instagram routes on the workspace role and the plan flag `access_instagram`.
-- Linking or unlinking an account (unlinking deletes every Instagram thread of the workspace), and sending a reply-only broadcast,
-- are separate keys from reading the hub so a workspace can hand them out apart. Replying in the inbox stays under the inbox keys.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('ig.accounts.read',      'View Instagram accounts',                 'instagram', false),
  ('ig.accounts.manage',    'Link and unlink Instagram accounts',      'instagram', false),
  ('ig.broadcasts.manage',  'Send Instagram reply-only broadcasts',    'instagram', false)
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
    ('ig.accounts.read'),
    ('ig.accounts.manage'),
    ('ig.broadcasts.manage')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
