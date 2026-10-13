-- lsc: capability key for reviewing the stage changes the AI suggests. Not a Reference feature.
--
--   lsc.stage.review   accept or dismiss an AI-suggested lifecycle stage (accepting still needs the permission to edit the contact,
--                      because the stage is changed through the same path as an edit)
--
-- Same holders as lsc.contacts.score: the Owner and Admin presets get every new key by the trigger on `permission_defs`; the Manager
-- preset gets it here and in `workspace_preset_baseline`. Agent and Viewer hold none.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('lsc.stage.review', 'Accept or dismiss AI-suggested lifecycle stages', 'ai', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'lsc.stage.review'
FROM (VALUES ('admin'), ('workspace_admin'), ('manager')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
