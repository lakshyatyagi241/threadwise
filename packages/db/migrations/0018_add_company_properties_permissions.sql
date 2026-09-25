-- 0018_add_company_properties_permissions
-- CRUD capability keys for the field-metadata module scoped to companies
-- (Phase 7). Same registry tables as Phase 8's contact-properties, distinct
-- permission keys per moduleKey so a grant to one doesn't leak into the
-- other — see field-metadata-permission.ts for the moduleKey -> key mapping.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.company-properties.read',   'View company field definitions',   'crm', false),
  ('record.company-properties.create', 'Create company field definitions', 'crm', false),
  ('record.company-properties.update', 'Edit company field definitions',   'crm', false),
  ('record.company-properties.delete', 'Delete company field definitions', 'crm', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;
