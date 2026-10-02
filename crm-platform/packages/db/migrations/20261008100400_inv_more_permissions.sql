-- inv: capability keys for credit notes, recurring invoices and sales orders (same shape as 20261007100200).
-- Credit notes, recurring schedules and orders are records like invoices: record scope on the PEOPLE of the record (`own` is "owned by me
-- or created by me", `team` adds my teams, `all` is the workspace). The front-line preset (Agent / Counsellor) works its own orders and
-- reads its own credit notes and schedules; issuing credit notes, voiding them and running schedules stay with the people a workspace
-- widens the role for.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.credit-notes.read',    'View credit notes',                       'crm', true),
  ('record.credit-notes.create',  'Create credit notes (drafts)',            'crm', false),
  ('record.credit-notes.issue',   'Issue credit notes (moves money)',        'crm', true),
  ('record.credit-notes.void',    'Void credit notes',                       'crm', true),
  ('record.credit-notes.delete',  'Delete draft credit notes',               'crm', true),
  ('record.recurring-invoices.read',   'View recurring invoices',            'crm', true),
  ('record.recurring-invoices.create', 'Create recurring invoices',          'crm', false),
  ('record.recurring-invoices.update', 'Edit, pause, resume and run recurring invoices', 'crm', true),
  ('record.recurring-invoices.delete', 'Delete recurring invoices',          'crm', true),
  ('record.sales-orders.read',    'View sales orders',                       'crm', true),
  ('record.sales-orders.create',  'Create sales orders',                     'crm', false),
  ('record.sales-orders.update',  'Edit, confirm, cancel and fulfil sales orders', 'crm', true),
  ('record.sales-orders.invoice', 'Create invoices from sales orders',       'crm', true),
  ('record.sales-orders.delete',  'Delete draft sales orders',               'crm', true)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('record.credit-notes.read'), ('record.credit-notes.create'), ('record.credit-notes.issue'), ('record.credit-notes.void'),
    ('record.credit-notes.delete'),
    ('record.recurring-invoices.read'), ('record.recurring-invoices.create'), ('record.recurring-invoices.update'),
    ('record.recurring-invoices.delete'),
    ('record.sales-orders.read'), ('record.sales-orders.create'), ('record.sales-orders.update'), ('record.sales-orders.invoice'),
    ('record.sales-orders.delete')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';

INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', k.scope::record_scope
  FROM roles r
  CROSS JOIN (VALUES
    ('record.credit-notes.read', 'own'),
    ('record.recurring-invoices.read', 'own'),
    ('record.sales-orders.read', 'own'), ('record.sales-orders.create', 'all'), ('record.sales-orders.update', 'own')
  ) AS k(key, scope)
  WHERE r.system_key IS NULL AND r.name IN ('Agent', 'Counsellor')
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE organizations SET roles_version = roles_version + 1;
