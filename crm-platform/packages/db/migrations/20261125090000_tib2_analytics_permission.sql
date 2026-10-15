-- tib2: capability key for the Team Performance report (TW-TIB2-034).
--
--   inbox.analytics.view   open the Team Inbox performance reports (replies, resolutions and response times per agent)
--
-- Reference showed the page to Manager and above and left its JSON endpoint open to every member (any viewer could read per-agent
-- numbers). The key gates both here. Owner and Admin presets get every new key by the trigger on `permission_defs`; the Manager preset
-- gets it here and in `workspace_preset_baseline`. Agent and Viewer hold none.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('inbox.analytics.view', 'View Team Inbox performance reports', 'inbox', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'inbox.analytics.view'
FROM (VALUES ('admin'), ('workspace_admin'), ('manager')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
