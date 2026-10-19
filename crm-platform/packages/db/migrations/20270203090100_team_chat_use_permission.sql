-- Team chat: a key for the menu entry.
-- Why this migration exists: the Team chat menu entry carried no permission gate (any staff user is a chat member), so a workspace could not be
-- configured without it: closing the team-chat module of the Waboo migration removed the API (plan feature team_chat) but left the menu. A
-- key of its own fixes that. Every role holds it (that is the existing behaviour); the migration ceiling denies it where a workspace never had team chat.
--   tchat.chat.use   see the Team chat menu entry and open team chat

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('tchat.chat.use', 'Use team chat (see the menu entry and open it)', 'team-chat', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'tchat.chat.use'
FROM (VALUES ('admin'), ('workspace_admin'), ('manager'), ('agent'), ('viewer')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

-- `organizations` and `role_grants` are under FORCE ROW LEVEL SECURITY: the statements below need the privileged flag.
SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;

-- every custom role too: any staff user is a chat member today
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
SELECT r.org_id, r.id, 'tchat.chat.use', 'allow', 'all'
FROM roles r
WHERE r.system_key IS NULL
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

UPDATE organizations SET roles_version = roles_version + 1;
