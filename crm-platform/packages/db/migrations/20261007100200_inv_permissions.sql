-- inv: capability keys for invoices, payments and tax rates.
-- Why this migration exists (WD-INV-024, D-14): WaDesk gated invoicing on one plan flag plus "workspace admin", with no permission
-- keys, so every admin could void nothing only because nothing could be voided, and an agent had no way to be given "record a
-- payment" without being made an admin. Here an invoice is a record like a deal (record.invoices.*, record scope on the PEOPLE of
-- the invoice: `own` is "owned by me or created by me", `team` adds the people on my teams, `all` is the workspace); payments and
-- tax rates have keys of their own.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.invoices.read',     'View invoices',                                    'crm', true),
  ('record.invoices.create',   'Create invoices (drafts)',                         'crm', false),
  ('record.invoices.update',   'Edit invoices and manage their public link',       'crm', true),
  ('record.invoices.issue',    'Issue and send invoices',                          'crm', true),
  ('record.invoices.void',     'Void invoices',                                    'crm', true),
  ('record.invoices.delete',   'Delete draft invoices',                            'crm', true),
  ('record.invoices.settings', 'Manage invoice numbering, defaults and online payment', 'crm', false),
  ('record.payments.read',     'View payments and the aging report',               'crm', true),
  ('record.payments.create',   'Record payments against invoices',                 'crm', true),
  ('record.payments.refund',   'Refund payments',                                  'crm', true),
  ('record.tax-rates.read',    'View tax rates',                                   'crm', false),
  ('record.tax-rates.create',  'Create tax rates',                                 'crm', false),
  ('record.tax-rates.update',  'Edit tax rates and choose the default',            'crm', false),
  ('record.tax-rates.delete',  'Delete tax rates',                                 'crm', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new keys by
-- unlocking, granting and relocking here, as the contacts, deals, tasks and sales-docs migrations do. New organizations get every
-- key in permission_defs when they are provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('record.invoices.read'), ('record.invoices.create'), ('record.invoices.update'), ('record.invoices.issue'),
    ('record.invoices.void'), ('record.invoices.delete'), ('record.invoices.settings'),
    ('record.payments.read'), ('record.payments.create'), ('record.payments.refund'),
    ('record.tax-rates.read'), ('record.tax-rates.create'), ('record.tax-rates.update'), ('record.tax-rates.delete')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';

-- The editable front-line preset (Agent from sign-up, Counsellor from the dev seed) bills its own customers: it reads and edits
-- the invoices that are its own, creates drafts, records the payments it collects on them and reads the tax rates. Issuing
-- (which allocates a legal number), voiding, deleting, refunding and the settings stay with the people a workspace widens the
-- role for.
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', k.scope::record_scope
  FROM roles r
  CROSS JOIN (VALUES
    ('record.invoices.read', 'own'), ('record.invoices.create', 'all'), ('record.invoices.update', 'own'),
    ('record.payments.read', 'own'), ('record.payments.create', 'own'),
    ('record.tax-rates.read', 'all')
  ) AS k(key, scope)
  WHERE r.system_key IS NULL AND r.name IN ('Agent', 'Counsellor')
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE organizations SET roles_version = roles_version + 1;
