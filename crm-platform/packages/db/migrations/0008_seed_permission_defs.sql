-- 0008_seed_permission_defs
-- The platform capability registry.
--
-- Route guards reference these keys directly. Custom modules auto-register
-- their own CRUD keys at creation time (record.<module>.<action>), which is
-- why this table is global and not tenant-scoped.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  -- CRM records
  ('record.contacts.read',      'View contacts',          'crm', true),
  ('record.contacts.create',    'Create contacts',        'crm', false),
  ('record.contacts.update',    'Edit contacts',          'crm', true),
  ('record.contacts.delete',    'Delete contacts',        'crm', true),
  ('record.contacts.export',    'Export contacts',        'crm', true),
  ('record.contacts.merge',     'Merge contacts',         'crm', true),
  ('record.companies.read',     'View companies',         'crm', true),
  ('record.companies.create',   'Create companies',       'crm', false),
  ('record.companies.update',   'Edit companies',         'crm', true),
  ('record.companies.delete',   'Delete companies',       'crm', true),

  -- Inbox
  ('inbox.conversation.read',   'View conversations',     'inbox', true),
  ('inbox.conversation.reply',  'Reply in conversations', 'inbox', true),
  ('inbox.conversation.assign', 'Assign conversations',   'inbox', true),
  ('inbox.conversation.resolve','Resolve conversations',  'inbox', true),

  -- Broadcast
  ('broadcast.template.manage', 'Manage templates',       'broadcast', false),
  ('broadcast.campaign.read',   'View campaigns',         'broadcast', true),
  ('broadcast.campaign.create', 'Create campaigns',       'broadcast', false),
  ('broadcast.campaign.start',  'Start/stop campaigns',   'broadcast', false),

  -- Billing
  ('billing.wallet.read',       'View wallet',            'billing', false),
  ('billing.wallet.topup',      'Top up wallet',          'billing', false),
  ('billing.ratecard.manage',   'Manage rate cards',      'billing', false),
  ('billing.invoice.read',      'View invoices',          'billing', false),

  -- Exams
  ('exam.form.manage',          'Manage exam forms',      'exams', false),
  ('exam.application.read',     'View applications',      'exams', true),
  ('exam.application.verify',   'Verify applications',    'exams', true),

  -- Partner / sub-agent management (staff side)
  ('partner.agent.read',        'View sub-agents',        'partner', false),
  ('partner.agent.manage',      'Create/suspend sub-agents', 'partner', false),
  ('partner.lead.read',         'View agent-submitted leads', 'partner', true),

  -- Platform administration
  ('admin.user.manage',         'Manage users',           'admin', false),
  ('admin.role.manage',         'Manage roles',           'admin', false),
  ('admin.apikey.manage',       'Manage API keys',        'admin', false),
  ('admin.module.manage',       'Manage modules/fields',  'admin', false),
  ('admin.settings.manage',     'Manage org settings',    'admin', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;
