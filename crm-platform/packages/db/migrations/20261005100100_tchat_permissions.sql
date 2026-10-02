-- tchat: capability keys for the admin-only parts of team chat.
-- Why this migration exists (WD-TCHAT-002): WaDesk gave every workspace member the whole chat and kept three things for
-- `owner` and `admin`: creating and deleting channels, deciding invitation requests, and deleting or pinning other people's
-- messages. Those three become keys, so a workspace can hand them to a manager in its role editor. Reading and posting need no
-- key: any active staff user is a member (WaDesk applied no permission there either). The Admin preset gets all three.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('tchat.channel.manage',   'Create and delete team chat channels, manage private channel members', 'team-chat', false),
  ('tchat.invite.approve',   'See and decide team chat invitation requests',                          'team-chat', false),
  ('tchat.message.moderate', 'Delete or pin other people''s team chat messages',                      'team-chat', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role): existing organizations get the keys by
-- unlocking, granting and relocking, as the task migration does. New organizations get every key in permission_defs.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES ('tchat.channel.manage'), ('tchat.invite.approve'), ('tchat.message.moderate')) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
