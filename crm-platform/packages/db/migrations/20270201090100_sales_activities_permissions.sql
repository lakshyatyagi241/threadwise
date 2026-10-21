-- Sales activities settings (BL-370..BL-379): the capability keys for the Sales Activities settings page and who holds them by default.
-- Why this migration exists: new keys arrive by migration so the roles can be reviewed before a route uses them.
--
--   crm.activity_types.read    open Settings > Sales Activities and read the lists (the pickers on tasks, meetings and calls read the same lists
--                              through the permissions those screens already need, so a salesperson does not need this key)
--   crm.activity_types.manage  edit an activity's switches, task types and outcomes, and create or remove a custom activity
--
-- Owner and Admin receive both through `trg_permission_defs_grant_presets`; Manager can read.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('crm.activity_types.read',   'See the sales activities settings (task types and outcomes)', 'crm', false),
  ('crm.activity_types.manage', 'Manage sales activities: switches, task types, outcomes, custom activities', 'crm', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset),
     (VALUES ('crm.activity_types.read'), ('crm.activity_types.manage')) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;
INSERT INTO workspace_preset_baseline (preset_key, permission_key) VALUES ('manager', 'crm.activity_types.read')
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
