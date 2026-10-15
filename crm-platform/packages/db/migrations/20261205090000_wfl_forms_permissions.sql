-- wfl: permissions for WhatsApp Forms (docs/threadwise-port/inventory/forms-links-groups.md TW-WFL-011).
-- Reference gated `/wa-forms` on `plan:access_wa_forms`, a key with no backing column (a PLAN-owned gap documented in
-- plans-subscriptions-trials.md), so the route was open on every plan regardless. The real gate already exists as
-- the plan feature `forms_and_links` (packages/contracts/src/plans-subscriptions-trials/catalogue.ts) — Reference's
-- own name for "WhatsApp Flows forms", on by default — so this migration only adds the permission keys; no plan
-- backfill is needed (a plan row that predates a feature key takes the registry default).
--
-- Submissions hold a customer's answers (personal data), so reading and exporting them are separate keys from
-- authoring/publishing a form, same split pattern as `waba.groups.read` vs `.manage`.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('wfl.forms.read',             'View WhatsApp forms',                                   'whatsapp', false),
  ('wfl.forms.create',           'Create WhatsApp forms',                                 'whatsapp', false),
  ('wfl.forms.manage',           'Edit, publish and duplicate WhatsApp forms',             'whatsapp', false),
  ('wfl.forms.delete',           'Delete WhatsApp forms',                                 'whatsapp', false),
  ('wfl.form-submissions.read',   'View WhatsApp form submissions',                        'whatsapp', false),
  ('wfl.form-submissions.export', 'Export WhatsApp form submissions as CSV',               'whatsapp', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
CROSS JOIN (VALUES
  ('wfl.forms.read'),
  ('wfl.forms.create'),
  ('wfl.forms.manage'),
  ('wfl.forms.delete'),
  ('wfl.form-submissions.read'),
  ('wfl.form-submissions.export')
) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
