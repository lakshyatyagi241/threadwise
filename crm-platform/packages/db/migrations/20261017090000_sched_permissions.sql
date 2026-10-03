-- sched: capability keys for scheduled messages and the number warmer.
-- Why this migration exists (WD-SCHED-019, 041): WaDesk gated every /scheduled route behind the workspace role `manager`
-- (owner > admin > manager > agent > viewer; agents and viewers were sent to the team inbox) and the /warmer page behind the
-- `admin` tier of its menu. They are keys here so a workspace can change who may schedule or warm, and the presets hold them
-- as WaDesk's roles did: Owner, Admin and Manager can read and manage schedules, Owner and Admin can change a number's warmer.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('sched.schedules.read',   'View scheduled messages',                      'messaging', false),
  ('sched.schedules.manage', 'Create, edit, pause and cancel scheduled messages', 'messaging', false),
  ('sched.warmer.manage',    'View and change the WhatsApp number warmer',   'messaging', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin'), ('manager')) AS p(preset)
CROSS JOIN (VALUES ('sched.schedules.read'), ('sched.schedules.manage')) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'sched.warmer.manage'
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
