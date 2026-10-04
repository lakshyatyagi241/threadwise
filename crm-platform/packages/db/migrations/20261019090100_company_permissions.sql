-- company: capability keys for companies and who holds them by default.
-- Why this migration exists (TW-CTP-001, D-02): Reference put every companies route behind the plan flag and nothing else, so any member
-- could list, edit and delete every company. Here a company is a record like a contact (record.companies.*, with a record scope:
-- `own` is "owned by me or created by me", `team` adds the people on my teams, `all` is the workspace). The four keys were seeded
-- by 0008 for the platform's generic CRM and are refreshed here with the labels the Roles screen shows; the Owner and Admin presets
-- hold every key, and the Manager preset holds `record.companies.%` (20261013100000), so only the front-line preset needs a decision.
--
-- Agent: companies are shared accounts, so an Agent reads and creates them at scope `all` (to pick one on a contact, a deal or a
-- task) and edits the ones it owns or created. Nothing destructive: deleting a company is a Manager right. A workspace widens or
-- narrows that in its role editor. Viewer: nothing.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.companies.read',   'View companies',                         'crm', true),
  ('record.companies.create', 'Create companies',                       'crm', false),
  ('record.companies.update', 'Edit companies and link their contacts', 'crm', true),
  ('record.companies.delete', 'Delete companies',                       'crm', true)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- `workspace_preset_baseline` is the place a domain declares a grant every organization's preset should hold (see
-- 20261014090000): new organizations get it at provisioning, existing ones below.
INSERT INTO workspace_preset_baseline (preset_key, permission_key, record_scope) VALUES
  ('agent', 'record.companies.read',   'all'),
  ('agent', 'record.companies.create', 'all'),
  ('agent', 'record.companies.update', 'own')
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
