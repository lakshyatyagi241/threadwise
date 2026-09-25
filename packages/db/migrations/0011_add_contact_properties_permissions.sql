-- 0011_add_contact_properties_permissions
-- CRUD capability keys for the field-metadata module (Phase 8). Distinct
-- from the existing 'admin.module.manage' toggle: that key is a single
-- non-scoped switch, while every route here needs its own action-level key
-- (read vs delete are not the same grant) — the standard record.<module>.*
-- shape every other entity uses.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.contact-properties.read',   'View contact field definitions',   'crm', false),
  ('record.contact-properties.create', 'Create contact field definitions', 'crm', false),
  ('record.contact-properties.update', 'Edit contact field definitions',   'crm', false),
  ('record.contact-properties.delete', 'Delete contact field definitions', 'crm', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;
