-- gacc: the workspace's Google account is one connection shared by the appointments calendar and the flow builder's Google nodes.
-- Why this migration exists (TW-GACC-001 to 006): `appointment_calendar_connections` already holds exactly one sealed Google grant per
-- workspace (Reference kept the same single grant inside `appointment_settings` and used it for Calendar, Meet, Sheets, Docs and Forms).
-- Until now only the calendar read it; the flow nodes were bound to a stub that always said "no account". Opening the same row to the
-- flow nodes needs three small things, all on that table:
--   * `last_error_code` / `last_error_at` / `last_error_capability`: the last account-level failure a feature met (rate limit, an API the
--     platform has not enabled, a refused grant), shown on the Google account page and cleared by the next success of the SAME capability (a
--     working Calendar must not hide a Sheets API that is switched off). Recorded only on change, so a busy flow never writes per call.
--   * `last_used_at`: when a booking or a flow node last used the account, written at most once a minute.
--   * two permission keys, because connecting Google for flows must not need `record.booking-types.update`.
-- The table keeps its name on purpose: renaming it would touch the appointments repository, its audit module key and its tests for no gain.

ALTER TABLE appointment_calendar_connections
  ADD COLUMN last_error_code text,
  ADD COLUMN last_error_at timestamptz,
  ADD COLUMN last_error_capability text,
  ADD COLUMN last_used_at timestamptz,
  ADD CONSTRAINT chk_appointment_calendar_connections_last_error CHECK (
    (last_error_code IS NULL) = (last_error_at IS NULL)
  ),
  ADD CONSTRAINT chk_appointment_calendar_connections_last_error_capability CHECK (
    last_error_capability IS NULL OR last_error_capability IN ('calendar', 'sheets', 'docs', 'forms', 'drive_listing')
  );

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('google.account.read',   'View the connected Google account',                             'integrations', false),
  ('google.account.manage', 'Connect, add permissions to and disconnect the Google account', 'integrations', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

-- Reference let a workspace admin manage the Google account (`EnsureWorkspaceRole:admin`): the admin presets get both keys.
INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
CROSS JOIN (VALUES ('google.account.read'), ('google.account.manage')) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
