-- deal: capability keys for deals, pipelines and their configuration.
-- Why this migration exists (WD-DEAL-001, D-02): WaDesk put every deals route behind the plan flag and nothing else, so a viewer
-- could create, move and delete. Here a deal is a record like a contact (record.deals.*, with a record scope on the owner),
-- and the pipeline editor, the stage ladder, the lost-reason list and the deal settings are one configuration resource
-- (record.pipelines.*) that a workspace can hand out separately from working deals. record.deals.report is its own key so a
-- rep can work deals without seeing the pipeline-wide numbers.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.deals.read',       'View deals',                   'crm', true),
  ('record.deals.create',     'Create deals',                 'crm', false),
  ('record.deals.update',     'Edit and move deals',          'crm', true),
  ('record.deals.delete',     'Delete deals',                 'crm', true),
  ('record.deals.report',     'View deal reports',            'crm', true),
  ('record.pipelines.read',   'View pipelines and stages',    'crm', false),
  ('record.pipelines.create', 'Create pipelines',             'crm', false),
  ('record.pipelines.update', 'Edit pipelines, stages, lost reasons and deal settings', 'crm', false),
  ('record.pipelines.delete', 'Delete pipelines, stages and lost reasons', 'crm', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new keys
-- by unlocking, granting and relocking here, as the contacts migration does. New organizations get every key in
-- permission_defs when they are provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('record.deals.read'), ('record.deals.create'), ('record.deals.update'), ('record.deals.delete'),
    ('record.deals.report'), ('record.pipelines.read'), ('record.pipelines.create'),
    ('record.pipelines.update'), ('record.pipelines.delete')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';

-- The editable front-line preset (named Agent by sign-up, Counsellor by the dev seed) works its own deals: it sees and edits the
-- ones it owns, creates new ones, and reads the pipeline ladder to pick a stage. Nothing destructive, no reports, no
-- configuration: a workspace widens that in its role editor.
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', k.scope::record_scope
  FROM roles r
  CROSS JOIN (VALUES
    ('record.deals.read', 'own'), ('record.deals.create', 'all'), ('record.deals.update', 'own'),
    ('record.pipelines.read', 'all')
  ) AS k(key, scope)
  WHERE r.system_key IS NULL AND r.name IN ('Agent', 'Counsellor')
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE organizations SET roles_version = roles_version + 1;
