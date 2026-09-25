-- 0015_add_tags_and_views_permissions
-- Phase 11: tags (flat org-wide taxonomy) and contact_views (saved list
-- views) are new resources distinct from record.contacts.* — a tag can be
-- read/managed independently of any one contact.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.tags.read',           'View tags',              'crm', false),
  ('record.tags.create',         'Create tags',             'crm', false),
  ('record.tags.update',         'Edit tags',               'crm', false),
  ('record.tags.delete',         'Delete tags',             'crm', false),
  ('record.contact-views.read',   'View saved contact views',   'crm', false),
  ('record.contact-views.create', 'Create saved contact views', 'crm', false),
  ('record.contact-views.update', 'Edit saved contact views',   'crm', false),
  ('record.contact-views.delete', 'Delete saved contact views', 'crm', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;
