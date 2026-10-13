-- lsc: capability keys for AI lead scoring. Not a Reference feature, so no Reference key to mirror.
--
-- Who holds them: the Owner and Admin presets get every new key by the trigger on `permission_defs` (20261013100000). The Manager preset
-- gets the read key and the per-contact score key here and, through `workspace_preset_baseline`, in every workspace provisioned later;
-- it does NOT get `lsc.settings.manage`, because switching on the sending of contact data to an AI vendor is the owner's call.
-- Agent and Viewer hold none (a Viewer still sees a score on a contact: the score is part of the contact they can already read).
--   lsc.runs.read         the scoring log and what it cost
--   lsc.contacts.score    score one contact now, or start the backfill for the workspace
--   lsc.settings.manage   the workspace switch

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('lsc.runs.read',       'View the AI lead scoring log and its cost',         'ai', false),
  ('lsc.contacts.score',  'Score contacts with AI, one at a time or in bulk',  'ai', false),
  ('lsc.settings.manage', 'Switch AI lead scoring on or off for the workspace', 'ai', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin'), ('manager')) AS p(preset)
CROSS JOIN (VALUES ('lsc.runs.read'), ('lsc.contacts.score')) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'lsc.settings.manage'
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
