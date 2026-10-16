-- companies: capability keys for the CSV export and import.
-- Why this migration exists (BL-196): a file of every company a person may see leaves the product, and a file can create hundreds
-- of companies at once. Both are bigger than reading or creating one company, so each is its own key (like record.contacts.export and
-- record.contacts.import) and a workspace hands them out apart. The export honours the record scope of its key (`own`, `team`,
-- `all`); the import also needs record.companies.create, and fills an existing company only inside the caller's
-- record.companies.update scope.
--
-- The Owner and Admin presets receive a new key through trigger trg_permission_defs_grant_presets (20261013100000). The Manager
-- preset copied its grants once, at provisioning, so it is listed in `workspace_preset_baseline` (see 20261014090000): new
-- organizations get it at provisioning, existing ones below. Agent and Viewer: nothing.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.companies.export', 'Export companies to a file', 'crm', true),
  ('record.companies.import', 'Import companies from a file', 'crm', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key, record_scope) VALUES
  ('manager', 'record.companies.export', 'all'),
  ('manager', 'record.companies.import', 'all')
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
