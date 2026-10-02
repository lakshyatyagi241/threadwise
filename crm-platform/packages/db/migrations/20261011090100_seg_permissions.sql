-- seg: capability keys for segments.
-- Why this migration exists: a segment is its own resource (record.segments.*). read is workspace-wide: what a caller may see is
-- decided by the segment's visibility (private = its owner and admins), not by a record scope. update and delete take a scope: `own`
-- is "segments I own", `all` is every segment in the workspace and is also what makes a caller an admin of private segments.
-- Creating a segment, or using one on contacts (filter, export, tag, add to group), needs the matching contacts permission as well.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.segments.read',   'View segments',   'crm', false),
  ('record.segments.create', 'Create segments', 'crm', false),
  ('record.segments.update', 'Edit segments',   'crm', true),
  ('record.segments.delete', 'Delete segments', 'crm', true)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new keys by
-- unlocking, granting and relocking here, as the tasks and contacts migrations do. New organizations get every key in
-- permission_defs when they are provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('record.segments.read'), ('record.segments.create'), ('record.segments.update'), ('record.segments.delete')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';

-- The editable front-line preset (Agent by sign-up, Counsellor by the dev seed): read and create, and edit or delete the segments
-- it owns. A workspace widens that in its role editor.
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', k.scope::record_scope
  FROM roles r
  CROSS JOIN (VALUES
    ('record.segments.read', 'all'), ('record.segments.create', 'all'),
    ('record.segments.update', 'own'), ('record.segments.delete', 'own')
  ) AS k(key, scope)
  WHERE r.system_key IS NULL AND r.name IN ('Agent', 'Counsellor')
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE organizations SET roles_version = roles_version + 1;
