-- wfl: permissions for the WhatsApp Link Generator (docs/threadwise-port/inventory/forms-links-groups.md TW-WFL-012..018).
-- Same plan feature as Forms: `forms_and_links` already exists in the registry (packages/contracts/src/plans-subscriptions-trials/
-- catalogue.ts) and bundles both Reference plan flags (`access_wa_forms`, `access_wa_links`) into one key, on by default.
-- The public redirect (`GET /l/:slug`) is unauthenticated and needs no permission key.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('wfl.links.read',   'View WhatsApp links',           'whatsapp', false),
  ('wfl.links.create', 'Create WhatsApp links',         'whatsapp', false),
  ('wfl.links.manage', 'Edit and duplicate WhatsApp links', 'whatsapp', false),
  ('wfl.links.delete', 'Delete WhatsApp links',         'whatsapp', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
CROSS JOIN (VALUES
  ('wfl.links.read'),
  ('wfl.links.create'),
  ('wfl.links.manage'),
  ('wfl.links.delete')
) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
