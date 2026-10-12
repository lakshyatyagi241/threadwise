-- mail phase 2: capability keys of personal mailboxes, signatures and the sharing policy (TW-MAIL-027, 035).
-- Why this migration exists: connecting one's own mailbox, keeping signatures and deciding whether the workspace allows personal mailboxes
-- are separate keys from `mail.mailboxes.manage` (the company mailboxes), so an agent can be given their own mailbox and signature without
-- being able to cut the company's support mailbox off, and only an admin decides the workspace policy.
--
-- Who holds them: Admin (the locked top preset) gets all three by unlock, grant, relock like 20261118090100. Existing Manager and Agent
-- presets get `mail.mailboxes.manage_personal` and `mail.signatures.manage` (the policy `mail.settings.manage` stays with admins).
-- `plan_feature = 'email_channel'` keeps the keys out of the Roles editor of a workspace without the add-on; every route checks the key AND
-- the plan feature.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('mail.mailboxes.manage_personal', 'Connect and manage your own personal email mailbox', 'mail', false),
  ('mail.signatures.manage',        'Create and edit email signatures',                    'mail', false),
  ('mail.settings.manage',          'Decide whether personal email mailboxes are allowed', 'mail', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

UPDATE permission_defs SET plan_feature = 'email_channel'
 WHERE key IN ('mail.mailboxes.manage_personal', 'mail.signatures.manage', 'mail.settings.manage');

SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('mail.mailboxes.manage_personal'),
    ('mail.signatures.manage'),
    ('mail.settings.manage')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';

INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('mail.mailboxes.manage_personal'),
    ('mail.signatures.manage')
  ) AS k(key)
  WHERE r.system_key IN ('manager', 'agent')
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

UPDATE organizations SET roles_version = roles_version + 1;
