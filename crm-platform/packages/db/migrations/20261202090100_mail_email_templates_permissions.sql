-- email templates: capability keys (BL-004 / E-14).
-- Why this migration exists: using a template in the composer and keeping the workspace's shared library are different powers, as for
-- signatures. `mail.templates.read` lets a member see the shared templates, insert them into a reply and keep PERSONAL templates of their
-- own; `mail.templates.manage` is what creates and changes SHARED templates (and archives or deletes them).
--
-- Who holds them: Admin (the locked top preset) gets both by unlock, grant, relock like 20261119090100. Manager gets both; Agent gets
-- `mail.templates.read`. `plan_feature = 'email_channel'` keeps the keys out of the Roles editor of a workspace without the add-on; every
-- route checks the key AND the plan feature.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('mail.templates.read',   'Use email templates and keep your own',        'mail', false),
  ('mail.templates.manage', 'Create and edit shared email templates',       'mail', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

UPDATE permission_defs SET plan_feature = 'email_channel'
 WHERE key IN ('mail.templates.read', 'mail.templates.manage');

SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('mail.templates.read'),
    ('mail.templates.manage')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';

INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('mail.templates.read'),
    ('mail.templates.manage')
  ) AS k(key)
  WHERE r.system_key = 'manager'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, 'mail.templates.read', 'allow', 'all'
  FROM roles r
  WHERE r.system_key = 'agent'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

UPDATE organizations SET roles_version = roles_version + 1;
