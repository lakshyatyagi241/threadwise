-- wadev groups: the four keys of the personal-number Groups tab (decision D4; same shape as 20261109090000 for the official groups).
-- Why this migration exists: the tab, creating a group, changing one (members, subject, restrictions, link, join requests, joining by link)
-- and leaving one are four keys a workspace can hand out apart. Groups belong to a number, not to a record owner, so none carries a record
-- scope. Held by Owner and Admin (Reference's web screen was admin only). `plan_feature` stays NULL on purpose (decision D1): the screen is
-- gated by the two-level unofficial-WhatsApp gate (platform switch + the workspace allow list), like every personal-number action.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('wa.groups.read',   'View the WhatsApp groups of a personal number and their members',                         'whatsapp', false),
  ('wa.groups.create', 'Create WhatsApp groups from a personal number',                                           'whatsapp', false),
  ('wa.groups.manage', 'Change a personal-number WhatsApp group (members, subject, settings, link, join requests)', 'whatsapp', false),
  ('wa.groups.leave',  'Leave WhatsApp groups with a personal number',                                            'whatsapp', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
CROSS JOIN (VALUES
  ('wa.groups.read'),
  ('wa.groups.create'),
  ('wa.groups.manage'),
  ('wa.groups.leave')
) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
