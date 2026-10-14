-- Capability keys for member leave and delegates (BL-112).
--
--   team.leave.read     see who is on leave and until when (the dates; the reason stays with the managers)
--   team.leave.manage   set leave and a delegate. The record scope decides for whom: `own` = only yourself (every member can, so
--                       nobody needs a manager to tell the team they are away), `all` = anyone (managers and above), and the
--                       reason of other people's leave is shown to this scope only.
--
-- The Owner and Admin presets receive every new key through the trigger on `permission_defs`; the others through the baseline.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('team.leave.read', 'See who is on leave', 'team', false),
  ('team.leave.manage', 'Set leave and a delegate', 'team', true)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key, record_scope)
VALUES
  ('admin', 'team.leave.read', 'all'),
  ('workspace_admin', 'team.leave.read', 'all'),
  ('manager', 'team.leave.read', 'all'),
  ('agent', 'team.leave.read', 'all'),
  ('viewer', 'team.leave.read', 'all'),
  ('admin', 'team.leave.manage', 'all'),
  ('workspace_admin', 'team.leave.manage', 'all'),
  ('manager', 'team.leave.manage', 'all'),
  ('agent', 'team.leave.manage', 'own'),
  ('viewer', 'team.leave.manage', 'own')
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
