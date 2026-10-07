-- forms: capability keys for the Forms add-on (docs/specs/forms-builder-app.md 12.4).
-- Why this migration exists: forms are records a person may own (so `record.forms.*` carry a record scope: `own` is "I created it", `team`
-- adds the people on my teams), and a submission holds a stranger's personal data, so reading, retrying, erasing and exporting submissions
-- are keys of their own (`record.form-submissions.*`) and can be given to a salesperson without letting them rebuild the form.
--
-- Who holds them: the Owner and Admin presets get every new key by the trigger on `permission_defs` (20261013100000). Existing Manager
-- and Agent presets get the spec's defaults below (Manager: forms read, create, update and submissions read, export; Agent: submissions
-- read at scope `own`). A workspace created later is provisioned by `provision_workspace_presets`, which does not know these keys: its
-- Manager and Agent start without them and the Roles editor widens that (the keys are hidden there until the app is owned).
--
-- `plan_feature = 'form_builder'` (20261027090000) keeps the keys out of the Roles editor of a workspace that has not bought the app;
-- enforcement is unchanged: every route checks the key AND the plan feature.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.forms.read',              'View forms',                                              'forms', true),
  ('record.forms.create',            'Create, duplicate and import forms',                      'forms', false),
  ('record.forms.update',            'Edit, publish, pause and archive forms',                  'forms', true),
  ('record.forms.delete',            'Delete forms',                                            'forms', true),
  ('record.form-submissions.read',   'View form submissions and their answers',                 'forms', true),
  ('record.form-submissions.update', 'Retry and review form submissions',                       'forms', true),
  ('record.form-submissions.delete', 'Erase the answers of a form submission',                  'forms', true),
  ('record.form-submissions.export', 'Export form submissions to CSV',                          'forms', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

UPDATE permission_defs SET plan_feature = 'form_builder' WHERE key LIKE 'record.form%';

SELECT set_config('app.privileged', 'on', true);

INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('record.forms.read'), ('record.forms.create'), ('record.forms.update'),
    ('record.form-submissions.read'), ('record.form-submissions.export')
  ) AS k(key)
  WHERE r.system_key = 'manager'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, 'record.form-submissions.read', 'allow', 'own'
  FROM roles r
  WHERE r.system_key = 'agent'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

UPDATE organizations SET roles_version = roles_version + 1;
