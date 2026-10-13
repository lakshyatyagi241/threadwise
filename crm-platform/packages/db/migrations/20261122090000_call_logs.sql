-- call: capability keys for the call log and call analytics, and the indexes the log reads by.
-- Why this migration exists (TW-CALL-022 onward): Reference put /call-logs behind the plan flag `access_waba_calling` and the menu tier
-- `admin` (Workspace owner and admin), and served every recording to anybody of the workspace who opened its URL. Here reading the log is a
-- key with a record scope (`call.logs.read`: all calls, a team's, or only the ones a person handled) and playing a recording is a key of
-- its own (`call.recordings.play`), because a recording is a customer's voice and every play is written to the audit trail.
--
-- Presets: Owner and Admin hold both at scope `all` (Reference's tier `admin`). The Manager preset, which places and answers calls
-- (`call.calls.use`), reads and plays the calls it handled itself (scope `own`): a deliberate addition so an operator can find their own
-- call and recording again. Agent and Viewer hold nothing. A workspace changes any of this in its role editor.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('call.logs.read',        'View the WhatsApp call log and call analytics', 'calling', true),
  ('call.recordings.play',  'Play WhatsApp call recordings',                  'calling', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key, record_scope) VALUES
  ('admin',           'call.logs.read',       'all'),
  ('admin',           'call.recordings.play', 'all'),
  ('workspace_admin', 'call.logs.read',       'all'),
  ('workspace_admin', 'call.recordings.play', 'all'),
  ('manager',         'call.logs.read',       'own'),
  ('manager',         'call.recordings.play', 'all')
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;

-- The log: a workspace's calls, newest first, inside a window of days (the list, its totals and every analytics query).
CREATE INDEX idx_wa_calls_org_started_at ON wa_calls (org_id, started_at DESC, id DESC);
-- A person's own calls (record scope `own`, the teammate filter, the by-teammate analytics).
CREATE INDEX idx_wa_calls_handler_started_at ON wa_calls (org_id, handler_user_id, started_at DESC)
  WHERE handler_user_id IS NOT NULL;
