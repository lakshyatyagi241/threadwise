-- consent: capability keys for the contact consent ledger and its settings. Not a reference feature.
--
-- Owner and Admin presets get every new key by the trigger on `permission_defs` (20261013100000). Manager gets the ledger read key
-- here and, through `workspace_preset_baseline`, in every workspace provisioned later. Only Owner/Admin may change consent for a
-- contact or the keyword / policy settings: consent is a legal record.
--   contacts.consent.read    see the consent card and timeline of a contact, export one contact's proof
--   contacts.consent.manage  record a consent event (mark subscribed / unsubscribed), export the workspace's proof
--   settings.consent.manage  STOP / START keywords, auto replies, the opt-out line and the policy switch

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('contacts.consent.read',   'View contact consent history and proof',                   'contacts', false),
  ('contacts.consent.manage', 'Record or withdraw a contact''s consent; export proof',    'contacts', false),
  ('settings.consent.manage', 'Manage STOP keywords, opt-out replies and the consent policy', 'settings', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, 'contacts.consent.read'
FROM (VALUES ('admin'), ('workspace_admin'), ('manager')) AS p(preset)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
CROSS JOIN (VALUES ('contacts.consent.manage'), ('settings.consent.manage')) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;
