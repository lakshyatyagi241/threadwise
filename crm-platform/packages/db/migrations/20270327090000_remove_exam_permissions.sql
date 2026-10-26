-- remove_exam_permissions: the exams capability group is gone from the roles editor.
-- Why this migration exists: Settings > Roles still listed "Manage exam forms", "View applications" and "Verify applications" under
-- an "exams" group. No route checks these keys (no @RequirePermission references them), so dropping them only removes the group.
--
--   exam.form.manage         manage exam forms
--   exam.application.read    view applications
--   exam.application.verify  verify applications
--
-- The locked preset roles refuse any change to their grants (protect_locked_role), so they are unlocked, cleaned and relocked exactly
-- as the other permission migrations do. Expand-only does not apply here: the keys go, so their grants go with them.

SELECT set_config('app.privileged', 'on', true);

CREATE TEMP TABLE _exam_locked_roles ON COMMIT DROP AS
  SELECT org_id, id FROM roles WHERE is_locked AND org_id IS NOT NULL;

UPDATE roles r SET is_locked = false
  FROM _exam_locked_roles l WHERE r.org_id = l.org_id AND r.id = l.id;

CREATE TEMP TABLE _exam_keys ON COMMIT DROP AS
  SELECT unnest(ARRAY['exam.form.manage', 'exam.application.read', 'exam.application.verify']) AS key;

DELETE FROM role_grants WHERE permission_key IN (SELECT key FROM _exam_keys);
DELETE FROM workspace_preset_baseline WHERE permission_key IN (SELECT key FROM _exam_keys);
DELETE FROM permission_defs WHERE key IN (SELECT key FROM _exam_keys);

UPDATE roles r SET is_locked = true
  FROM _exam_locked_roles l WHERE r.org_id = l.org_id AND r.id = l.id;

UPDATE organizations SET roles_version = roles_version + 1;
