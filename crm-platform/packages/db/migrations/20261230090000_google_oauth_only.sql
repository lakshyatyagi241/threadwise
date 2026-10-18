-- 20261230090000_google_oauth_only
-- Google Sheets is reached through the workspace's connected Google account (OAuth) and nothing else. The Google Sheets add-on
-- (Apps Script files, a personal key and a Webhook URL pasted by hand) is withdrawn:
--  1. every personal Sheets key stops working and is erased, with the two indexes that looked keys up, so no manual credential is left;
--  2. the `google-sheets` Marketplace listing is killed and its installations with it (the Marketplace keeps showing a killed app to the
--     workspaces that had installed it, with the reason). The `app.google-sheets.use` permission key stays, hidden, so role history is intact.
-- Connected Google accounts are not touched: they keep working, and a Sheets step needs no key.
DROP INDEX IF EXISTS uq_user_settings_sheets_key_hash;
DROP INDEX IF EXISTS idx_user_settings_sheets_key_hash;

SELECT set_config('app.privileged', 'on', true);

-- Expand step only. The four sheets_key_* columns on user_settings stay for this release: during a blue-green switch the LIVE slot
-- still runs the code that reads them (sheets-key.repository, workspace-settings.service), and dropping a column under it would break
-- that code until the switch finishes. The keys are erased instead (the columns hold NULL, which the old code reads as "no key").
-- The columns themselves are dropped by a later migration, once the release that stops reading them is live (contract step).
UPDATE user_settings
SET sheets_key_hash = NULL, sheets_key_suffix = NULL, sheets_key_created_at = NULL, sheets_key_last_used_at = NULL
WHERE sheets_key_hash IS NOT NULL OR sheets_key_suffix IS NOT NULL
   OR sheets_key_created_at IS NOT NULL OR sheets_key_last_used_at IS NOT NULL;

UPDATE workspace_app_installations i
SET status = 'killed', killed_at = now(),
    kill_reason = 'The Google Sheets add-on was withdrawn. Connect your Google account instead (Settings, Integrations, Google account).'
FROM marketplace_apps a
WHERE a.id = i.app_id AND a.slug = 'google-sheets' AND i.status <> 'killed';

UPDATE marketplace_apps SET status = 'killed' WHERE slug = 'google-sheets' AND status <> 'killed';
