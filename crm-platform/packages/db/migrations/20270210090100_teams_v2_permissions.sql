-- Teams v2 (BL-381, T1): the capability keys of the Teams screen.
--
--   team.read     see the Teams screen (teams, managers, members, who uses them)
--   team.manage   create, edit and delete teams, choose managers, parents, members and primary teams
--
-- `inbox.team.manage` stays for one release as an alias: either key lets a person edit teams (the API accepts both). Why: the Teams
-- screen served the inbox only, and the key was named after it; a Manager had `crm.assignment.manage` but not that key. Teams now
-- serve conversations, contacts, companies and deals together.
--
-- Who holds them
--   Owner, Admin    both, through the trigger on `permission_defs` (and the baseline rows below)
--   Manager         both
--   Agent           read
--   Viewer          neither (the spec asks for read on every non-viewer role)
--   custom roles    read when the role already grants anything at all, manage when it held `inbox.team.manage`, so nobody loses the screen

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('team.read',   'See teams and who leads them', 'team', false),
  ('team.manage', 'Create, edit and delete teams, managers and team membership', 'team', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key, record_scope)
VALUES
  ('admin', 'team.read', 'all'),
  ('workspace_admin', 'team.read', 'all'),
  ('manager', 'team.read', 'all'),
  ('agent', 'team.read', 'all'),
  ('admin', 'team.manage', 'all'),
  ('workspace_admin', 'team.manage', 'all'),
  ('manager', 'team.manage', 'all')
ON CONFLICT (preset_key, permission_key) DO NOTHING;

-- `organizations` and `role_grants` are under FORCE ROW LEVEL SECURITY: the statements below need the privileged flag.
SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;

-- Custom roles (no system_key): manage follows the alias, read follows "has any allow grant".
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
SELECT DISTINCT g.org_id, g.role_id, 'team.manage', 'allow'::perm_effect, 'all'::record_scope
FROM role_grants g
JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
WHERE g.permission_key = 'inbox.team.manage' AND g.effect = 'allow' AND r.system_key IS NULL
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
SELECT DISTINCT g.org_id, g.role_id, 'team.read', 'allow'::perm_effect, 'all'::record_scope
FROM role_grants g
JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
WHERE g.effect = 'allow' AND r.system_key IS NULL
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

UPDATE organizations SET roles_version = roles_version + 1;
