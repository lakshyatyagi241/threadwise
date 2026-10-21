-- 20270205090000_kb_per_agent_vector_faq_merge ends by `DELETE FROM role_grants WHERE permission_key LIKE 'faq.%'`. protect_locked_role
-- (0003_foundation) refuses ANY change to the grants of a locked preset role, so that DELETE fails with "role is locked: grants of a
-- platform preset role cannot be modified" on every database that has a workspace whose locked role holds an faq.* grant. A fresh test
-- database has no workspace, which is why the tests never saw it; a real database does, and the release rolls back at that migration.
--
-- Editing the merged migration would change its checksum on databases that already applied it, so this migration sorts just BEFORE it and
-- does the same delete the supported way (unlock, delete, relock exactly the roles that were locked, as the permission migrations do).
-- When 20270205090000 then runs, its own DELETE finds no row, so the trigger never fires. On a database that already applied it this is
-- a no-op. Expand-only: it removes only grants of capability keys that no longer exist.
SELECT set_config('app.privileged', 'on', true);

CREATE TEMP TABLE _faq_locked_roles ON COMMIT DROP AS
  SELECT org_id, id FROM roles WHERE is_locked AND org_id IS NOT NULL;

UPDATE roles r SET is_locked = false
  FROM _faq_locked_roles l WHERE r.org_id = l.org_id AND r.id = l.id;

DELETE FROM role_grants WHERE permission_key LIKE 'faq.%';

UPDATE roles r SET is_locked = true
  FROM _faq_locked_roles l WHERE r.org_id = l.org_id AND r.id = l.id;
