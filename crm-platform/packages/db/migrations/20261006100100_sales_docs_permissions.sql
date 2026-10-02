-- sales-docs: capability keys for proposals and estimates.
-- Why this migration exists (WD-PROP-001, D-02): WaDesk put proposals and estimates behind the plan flag and nothing else, so any
-- member could create, send, convert and delete every document. Here a document is a record like a deal (record.sales-docs.*,
-- one set for both kinds because it is one engine) and the record scope is on the PEOPLE of the document: `own` is "owned by me
-- or created by me", `team` adds the people on my teams, `all` is the workspace.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.sales-docs.read',    'View proposals and estimates',                         'crm', true),
  ('record.sales-docs.create',  'Create proposals and estimates',                       'crm', false),
  ('record.sales-docs.update',  'Edit, revise, duplicate and decide proposals and estimates', 'crm', true),
  ('record.sales-docs.send',    'Send proposals and estimates and manage their public link',  'crm', true),
  ('record.sales-docs.convert', 'Convert proposals and estimates to deals and invoices','crm', true),
  ('record.sales-docs.delete',  'Delete proposals and estimates',                       'crm', true),
  ('record.sales-docs.settings','Manage numbering, templates and defaults of proposals and estimates', 'crm', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new keys by
-- unlocking, granting and relocking here, as the contacts, deals and tasks migrations do. New organizations get every key in
-- permission_defs when they are provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('record.sales-docs.read'), ('record.sales-docs.create'), ('record.sales-docs.update'), ('record.sales-docs.send'),
    ('record.sales-docs.convert'), ('record.sales-docs.delete'), ('record.sales-docs.settings')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';

-- The editable front-line preset (Agent from sign-up, Counsellor from the dev seed) quotes for its own customers: it reads, edits
-- and sends the documents that are its own and creates new ones. Converting to an invoice or a deal, deleting and the module
-- settings stay with the people a workspace widens the role for.
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', k.scope::record_scope
  FROM roles r
  CROSS JOIN (VALUES
    ('record.sales-docs.read', 'own'), ('record.sales-docs.create', 'all'),
    ('record.sales-docs.update', 'own'), ('record.sales-docs.send', 'own')
  ) AS k(key, scope)
  WHERE r.system_key IS NULL AND r.name IN ('Agent', 'Counsellor')
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE organizations SET roles_version = roles_version + 1;
