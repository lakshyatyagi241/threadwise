-- call: capability keys for WhatsApp calling, and the indexes the call paths read by.
-- Why this migration exists (TW-CALL-003 to 019): Reference gated every calling route behind the workspace role `manager` (owner > admin >
-- manager > agent > viewer) and the plan feature `access_waba_calling`. The role gates are keys here so a workspace can change who may
-- place and answer calls or switch calling on a number; the presets hold them as Reference's roles did: Owner, Admin and Manager.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('call.calls.use',        'Place and answer WhatsApp calls, and read call recordings', 'calling', false),
  ('call.calling.manage',   'Turn WhatsApp calling on or off for a number',               'calling', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin'), ('manager')) AS p(preset)
CROSS JOIN (VALUES ('call.calls.use'), ('call.calling.manage')) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;

-- The incoming-call poll: ringing calls of a workspace, newest first (TW-CALL-012).
CREATE INDEX idx_wa_calls_ringing ON wa_calls (org_id, started_at DESC) WHERE status = 'ringing';
