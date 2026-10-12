-- mail: capability keys of the Email (Gmail) channel add-on (TW-MAIL-030).
-- Why this migration exists: seeing the connected mailboxes and connecting / renaming / syncing / disconnecting one are separate keys so a
-- supervisor can watch mailbox health without being able to cut the company's support mailbox off. Replying to an email thread uses the
-- inbox's own reply permission, not these.
--
-- `plan_feature = 'email_channel'` keeps the keys out of the Roles editor of a workspace that has not bought the add-on; enforcement is
-- unchanged: every route checks the key AND the plan feature (same model as the Forms keys, 20261031100100).

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('mail.mailboxes.read',   'View connected email mailboxes',                      'mail', false),
  ('mail.mailboxes.manage', 'Connect, rename, sync and disconnect email mailboxes', 'mail', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

UPDATE permission_defs SET plan_feature = 'email_channel' WHERE key IN ('mail.mailboxes.read', 'mail.mailboxes.manage');

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new keys by
-- unlocking, granting and relocking here. New organizations get every key in permission_defs when provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('mail.mailboxes.read'),
    ('mail.mailboxes.manage')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
