-- faq: capability keys for the FAQ knowledge base (ADR-0021). Not a WaDesk feature, so no WaDesk key to mirror.
--
-- Who holds them: the Owner and Admin presets get every new key by the trigger on `permission_defs` (20261013100000). The Manager
-- preset gets the entry and insight keys here and, through `workspace_preset_baseline`, in every workspace provisioned later; it does
-- NOT get `faq.settings.manage`, because switching answering on or off for customers and moving the matching bar is the owner's call.
-- Agent and Viewer hold none. Not behind a plan feature: none of the existing ones fits.
--   faq.entries.read      list and open FAQs and their variations, run the playground
--   faq.entries.create    add an FAQ, add or generate variations
--   faq.entries.update    edit an FAQ or a variation, pause it, learn a variation from an unanswered query
--   faq.entries.delete    delete an FAQ or a variation (bulk too)
--   faq.settings.manage   the workspace switch, threshold, margin and query logging
--   faq.insights.read     the match log, the unanswered list and the usage numbers

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('faq.entries.read',    'View FAQs and test how a question is matched',                 'ai', false),
  ('faq.entries.create',  'Add FAQs and their question variations',                       'ai', false),
  ('faq.entries.update',  'Edit FAQs and variations, and learn from unanswered questions', 'ai', false),
  ('faq.entries.delete',  'Delete FAQs and variations',                                   'ai', false),
  ('faq.settings.manage', 'Switch FAQ answering on or off and tune its matching',         'ai', false),
  ('faq.insights.read',   'View the FAQ match log, unanswered questions and usage',       'ai', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- What a workspace provisioned later starts with (workspaces that exist get theirs from the trigger and the apply call below).
INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin'), ('manager')) AS p(preset)
CROSS JOIN (VALUES
  ('faq.entries.read'),
  ('faq.entries.create'),
  ('faq.entries.update'),
  ('faq.entries.delete'),
  ('faq.insights.read')
) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

-- Switching answering on or off and tuning it is for the owner and admin, not the manager.
INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'faq.settings.manage'
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
