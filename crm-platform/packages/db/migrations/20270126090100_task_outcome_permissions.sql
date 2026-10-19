-- task outcomes: capability key. Not a reference feature (Waboo gated the Task Outcome page behind its data-management setting).
--
-- Reading the list needs no new key: it is what the outcome picker on a task offers, so `record.tasks.read` opens it. Changing the list
-- (add, rename, hide, reorder, delete) is a workspace setting, so it has its own key, held by the Owner and Admin presets like the other
-- settings that decide what a workspace keeps:
--   settings.task_outcomes.manage   add, rename, hide, reorder and delete task outcomes

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('settings.task_outcomes.manage', 'Manage the list of task outcomes', 'settings', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'settings.task_outcomes.manage'
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
