-- Channels hub: a key for the "All channels" coming-soon tile under Settings > Channels.
-- Why this migration exists: that tile is a placeholder with no gate, so every workspace sees it. A workspace migrated from Waboo has
-- no channel hub of its own and must not show it. A key of its own lets the migration deny it there, while every role keeps it
-- everywhere else (today's behaviour: the tile is visible to anyone who can open Settings).
--   chn.channels.read   see the "All channels" entry in Settings

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('chn.channels.read', 'See the channels hub', 'channels', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'chn.channels.read'
FROM (VALUES ('admin'), ('workspace_admin'), ('manager'), ('agent'), ('viewer')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

-- `organizations` and `role_grants` are under FORCE ROW LEVEL SECURITY: the statements below need the privileged flag.
SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;

-- every custom role too: the tile is visible to anyone today
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
SELECT r.org_id, r.id, 'chn.channels.read', 'allow', 'all'
FROM roles r
WHERE r.system_key IS NULL
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

UPDATE organizations SET roles_version = roles_version + 1;
