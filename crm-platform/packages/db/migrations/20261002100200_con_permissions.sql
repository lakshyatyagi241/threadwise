-- con: capability keys for contact groups and for CSV import.
-- Why this migration exists (TW-CON-033..037, 027): Reference gated the whole Contacts page on one role check. Here a group
-- is its own resource (like tags and saved views, record.<resource>.<action>), and importing a file is a capability a
-- workspace can hand out separately from creating a single contact. Everything else the new endpoints do reuses keys that
-- already exist: record.contacts.{read,create,update,delete,export,merge}, record.tags.*, record.contact-properties.*.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.contact-groups.read',   'View contact groups',   'crm', false),
  ('record.contact-groups.create', 'Create contact groups', 'crm', false),
  ('record.contact-groups.update', 'Edit contact groups',   'crm', false),
  ('record.contact-groups.delete', 'Delete contact groups', 'crm', false),
  ('record.contacts.import',       'Import contacts from a file', 'crm', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new
-- keys by unlocking, granting and relocking here, as the auth migration does. New organizations get every key in
-- permission_defs when they are provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('record.contact-groups.read'),
    ('record.contact-groups.create'),
    ('record.contact-groups.update'),
    ('record.contact-groups.delete'),
    ('record.contacts.import')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
