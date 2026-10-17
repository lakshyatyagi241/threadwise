-- call-logging: capability keys for logging a call and for running the call-logging setup, and who holds them by default.
-- Why this migration exists: the unified Call logs framework lets a person log a call by hand, a phone app report calls, and a telephony
-- provider report calls. Two new keys say who may do what; reading the log stays `call.logs.read` (its record scope says whose calls a
-- person sees, by who handled them, for the new entries exactly as for the WhatsApp ones).
--
--   call.logs.create     log a call, and edit or delete an entry you logged yourself while the workspace's edit window is open; it also
--                        lets the mobile app report calls as that person. Logging records a fact, so no consent rule blocks it.
--   call.logging.manage  the setup: the "create contacts from unknown callers" switch, the edit window, the telephony connections (and their
--                        callback secrets), and editing or deleting ANY entry at any time.
--
-- Presets. Owner and Admin receive every new key through `trg_permission_defs_grant_presets`. Manager and Agent can log calls (they are
-- the people who make them); only Manager and Agent get `call.logs.read` at scope `own` so a salesperson can find a call they handled
-- (the Manager already had it). Viewer holds nothing. A workspace changes any of this in its role editor.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('call.logs.create',    'Log a call, and edit or delete your own entries', 'calling', false),
  ('call.logging.manage', 'Manage call logging: settings, telephony connections, any entry', 'calling', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key, record_scope) VALUES
  ('manager', 'call.logs.create', 'all'),
  ('agent',   'call.logs.create', 'all'),
  ('agent',   'call.logs.read',   'own')
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
