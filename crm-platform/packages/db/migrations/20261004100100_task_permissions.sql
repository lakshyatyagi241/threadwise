-- task: capability keys for tasks.
-- Why this migration exists (TW-TASK-001, D-02): Reference put every task route behind the plan flag and nothing else, so any member
-- could read, edit and delete every task. Here a task is a record like a contact (record.tasks.*, with a record scope: `own` is
-- "assigned to me or created by me", `team` adds the people on my teams, `all` is the workspace).

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.tasks.read',   'View tasks',             'crm', true),
  ('record.tasks.create', 'Create tasks',           'crm', false),
  ('record.tasks.update', 'Edit and complete tasks, assign them', 'crm', true),
  ('record.tasks.delete', 'Delete tasks',           'crm', true)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new keys by
-- unlocking, granting and relocking here, as the contacts and deals migrations do. New organizations get every key in
-- permission_defs when they are provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('record.tasks.read'), ('record.tasks.create'), ('record.tasks.update'), ('record.tasks.delete')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';

-- The editable front-line preset (named Agent by sign-up, Counsellor by the dev seed) works the tasks that are its own: assigned
-- to it or created by it. A workspace widens that in its role editor.
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', k.scope::record_scope
  FROM roles r
  CROSS JOIN (VALUES
    ('record.tasks.read', 'own'), ('record.tasks.create', 'all'), ('record.tasks.update', 'own'), ('record.tasks.delete', 'own')
  ) AS k(key, scope)
  WHERE r.system_key IS NULL AND r.name IN ('Agent', 'Counsellor')
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE organizations SET roles_version = roles_version + 1;
