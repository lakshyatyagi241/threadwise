-- 20261230090000_google_oauth_only
-- Google Sheets is reached through the workspace's connected Google account (OAuth) and nothing else. The Google Sheets add-on
-- (Apps Script files, a personal key and a Webhook URL pasted by hand) is withdrawn:
--  1. every personal Sheets key stops working and is erased, with the two indexes that looked keys up, so no manual credential is left;
--  2. the `google-sheets` Marketplace listing is killed and its installations with it (the Marketplace keeps showing a killed app to the
--     workspaces that had installed it, with the reason). The `app.google-sheets.use` permission key stays, hidden, so role history is intact.
-- Connected Google accounts are not touched: they keep working, and a Sheets step needs no key.
DROP INDEX IF EXISTS uq_user_settings_sheets_key_hash;
DROP INDEX IF EXISTS idx_user_settings_sheets_key_hash;
ALTER TABLE user_settings
  DROP COLUMN IF EXISTS sheets_key_hash,
  DROP COLUMN IF EXISTS sheets_key_suffix,
  DROP COLUMN IF EXISTS sheets_key_created_at,
  DROP COLUMN IF EXISTS sheets_key_last_used_at;

SELECT set_config('app.privileged', 'on', true);

UPDATE workspace_app_installations i
SET status = 'killed', killed_at = now(),
    kill_reason = 'The Google Sheets add-on was withdrawn. Connect your Google account instead (Settings, Integrations, Google account).'
FROM marketplace_apps a
WHERE a.id = i.app_id AND a.slug = 'google-sheets' AND i.status <> 'killed';

UPDATE marketplace_apps SET status = 'killed' WHERE slug = 'google-sheets' AND status <> 'killed';
