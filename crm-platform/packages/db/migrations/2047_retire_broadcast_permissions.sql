-- 2047_retire_broadcast_permissions
-- Why this migration exists (not what it does — the SQL says that):
--
-- Campaigns are the one thing a workspace sends in bulk; the roles screen still listed two older permission sections beside them,
-- "Broadcast" (broadcast.campaign.*, broadcast.template.manage) and "Broadcasts" (bcast.broadcasts.*). Nothing should be grantable that
-- the product no longer offers, and two sections for one thing made roles hard to read. Every route and screen that checked those keys
-- now checks the campaign (or template) permission instead; this moves what roles already hold onto the same rights under the
-- campaign keys (a deny stays a deny), then removes the old keys.
--
--   bcast.broadcasts.read                      -> camp.campaigns.read
--   bcast.broadcasts.create                    -> camp.campaigns.create
--   bcast.broadcasts.delete                    -> camp.campaigns.delete
--   bcast.broadcasts.retry / .resume           -> camp.campaigns.control
--   bcast.broadcasts.export                    -> camp.campaigns.export
--   broadcast.campaign.read / .create / .start -> camp.campaigns.read / .create / .control
--   broadcast.template.manage                  -> tpl.templates.create
--
-- Idempotent: a second run finds nothing to move.

SELECT set_config('app.privileged', 'on', true);
SELECT set_config('app.rbac_preset_sync', 'on', true);

CREATE TEMP TABLE _retired_perm (old_key text PRIMARY KEY, new_key text NOT NULL) ON COMMIT DROP;
INSERT INTO _retired_perm (old_key, new_key) VALUES
  ('bcast.broadcasts.read', 'camp.campaigns.read'),
  ('bcast.broadcasts.create', 'camp.campaigns.create'),
  ('bcast.broadcasts.delete', 'camp.campaigns.delete'),
  ('bcast.broadcasts.retry', 'camp.campaigns.control'),
  ('bcast.broadcasts.resume', 'camp.campaigns.control'),
  ('bcast.broadcasts.export', 'camp.campaigns.export'),
  ('broadcast.campaign.read', 'camp.campaigns.read'),
  ('broadcast.campaign.create', 'camp.campaigns.create'),
  ('broadcast.campaign.start', 'camp.campaigns.control'),
  ('broadcast.template.manage', 'tpl.templates.create');

-- The right moves to the new key (scope all: the new keys carry no scope). Several old keys can land on one new key: one row per role,
-- a deny winning over an allow. An existing grant on the new key is kept, except that a deny from an old key still turns it into a deny.
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT DISTINCT ON (g.org_id, g.role_id, m.new_key) g.org_id, g.role_id, m.new_key, g.effect, 'all'
  FROM role_grants g
  JOIN _retired_perm m ON m.old_key = g.permission_key
  JOIN permission_defs d ON d.key = m.new_key
  ORDER BY g.org_id, g.role_id, m.new_key, (g.effect = 'deny') DESC
ON CONFLICT (org_id, role_id, permission_key) DO UPDATE
  SET effect = 'deny' WHERE EXCLUDED.effect = 'deny' AND role_grants.effect <> 'deny';

DELETE FROM role_grants WHERE permission_key IN (SELECT old_key FROM _retired_perm);
-- workspace_preset_baseline rows go with their key (ON DELETE CASCADE).
DELETE FROM permission_defs WHERE key IN (SELECT old_key FROM _retired_perm);

-- Cached grants reload.
UPDATE organizations SET roles_version = roles_version + 1;

SELECT set_config('app.rbac_preset_sync', 'off', true);
SELECT set_config('app.privileged', 'off', true);
