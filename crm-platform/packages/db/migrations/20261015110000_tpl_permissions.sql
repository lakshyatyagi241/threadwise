-- Message templates (TPL): permissions for the template library, authoring, submission to Meta and sync.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('tpl.templates.read',   'View WhatsApp message templates',                       'templates', false),
  ('tpl.templates.create', 'Create and edit WhatsApp message templates',            'templates', false),
  ('tpl.templates.delete', 'Delete WhatsApp message templates (also on Meta)',      'templates', false),
  ('tpl.templates.sync',   'Submit, refresh and sync templates with Meta',          'templates', false)
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
    ('tpl.templates.read'),
    ('tpl.templates.create'),
    ('tpl.templates.delete'),
    ('tpl.templates.sync')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
