-- TikTok channel: a key for the "coming soon" tile (and later the channel's own screens).
-- Why this migration exists: the TikTok tile under Settings > Channels is a placeholder with no gate, so every workspace sees it. A
-- workspace migrated from Waboo never had it and must not show it. A key of its own lets the migration deny it there, while every role
-- keeps it everywhere else (today's behaviour: the tile is visible to anyone who can open Settings).
--   chn.tiktok.read   see the TikTok channel entry in Settings

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('chn.tiktok.read', 'See the TikTok channel', 'channels', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'chn.tiktok.read'
FROM (VALUES ('admin'), ('workspace_admin'), ('manager'), ('agent'), ('viewer')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

-- `organizations` and `role_grants` are under FORCE ROW LEVEL SECURITY: the statements below need the privileged flag.
SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;

-- every custom role too: the tile is visible to anyone today
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
SELECT r.org_id, r.id, 'chn.tiktok.read', 'allow', 'all'
FROM roles r
WHERE r.system_key IS NULL
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;

UPDATE organizations SET roles_version = roles_version + 1;
