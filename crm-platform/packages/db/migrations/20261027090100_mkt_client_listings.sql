-- Marketplace: the `client` connector type, per-app permission keys, and the Chrome extension and Google Sheets add-on listings.
-- Why this migration exists (docs/specs/marketplace-extension-listings.md):
--  1. A client is software the member installs elsewhere and signs in to with their own account (the WaDesk extension and Sheets add-on).
--     It issues nothing and receives nothing at install, so it is a sixth connector type and has no row in marketplace_connections.
--  2. An app that has no keys of its own gets one `app.<slug>.use` key. `permission_defs.app_slug` hides the key in the Roles editor until
--     the workspace has the app installed. Enforcement is unchanged: routes check the key with @RequirePermission.
--  3. Both listings are seeded as DRAFT, free, in Productivity. The store addresses are not known yet: the operator adds them and publishes.
ALTER TABLE marketplace_apps DROP CONSTRAINT IF EXISTS chk_marketplace_apps_connector;
ALTER TABLE marketplace_apps ADD CONSTRAINT chk_marketplace_apps_connector CHECK (
  connector_type IS NULL OR connector_type IN ('oauth', 'push', 'pull', 'email_parse', 'webhook_relay', 'client'));

ALTER TABLE permission_defs ADD COLUMN IF NOT EXISTS app_slug text;

INSERT INTO permission_defs (key, label, category, supports_scope, app_slug) VALUES
  ('app.chrome-extension.use', 'Use the Chrome extension', 'marketplace', false, 'chrome-extension'),
  ('app.google-sheets.use',    'Use the Google Sheets add-on', 'marketplace', false, 'google-sheets')
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope, app_slug = EXCLUDED.app_slug;

INSERT INTO workspace_preset_baseline (preset_key, permission_key)
SELECT p.preset, k.key
FROM (VALUES ('admin'), ('workspace_admin')) AS p(preset)
CROSS JOIN (VALUES ('app.chrome-extension.use'), ('app.google-sheets.use')) AS k(key)
ON CONFLICT (preset_key, permission_key) DO NOTHING;

SELECT set_config('app.privileged', 'on', true);
SELECT apply_workspace_preset_baseline(id) FROM organizations;
UPDATE organizations SET roles_version = roles_version + 1;

-- --- the two listings (draft) -------------------------------------------------------------------------------------------------------------
WITH l (slug, name, tagline, long_desc, highlights) AS (
  VALUES
    ('chrome-extension', 'Chrome extension',
     'Save contacts and start chats from WhatsApp Web and other pages, straight into your workspace.',
     'Install the extension in Chrome, sign in with your own account and work from the pages you already use. Everything you do is recorded against you and follows your role.',
     '["Works with your own sign-in","Follows your role and permissions","Nothing is shared with other members"]'),
    ('google-sheets', 'Google Sheets add-on',
     'Send contacts and messages from a Google Sheet, and pull data from your workspace into it.',
     'Install the add-on in Google Sheets, create your personal key in your account settings and connect. Every action follows your role.',
     '["Bulk contacts from a sheet","Uses your personal key","Follows your role and permissions"]')
)
INSERT INTO marketplace_apps (slug, kind, category_id, name, tagline, status, first_party, featured, sort_order, connector_type, listing)
SELECT l.slug, 'integration', c.id, l.name, l.tagline, 'draft', true, false, 300, 'client',
       jsonb_build_object('longDescription', l.long_desc, 'highlights', l.highlights::jsonb)
FROM l, marketplace_categories c WHERE c.kind = 'integration' AND c.slug = 'productivity'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO marketplace_app_versions (app_id, version, status, manifest, recipe, scopes, changelog)
SELECT a.id, '1.0.0', 'draft',
       jsonb_build_object('manifestVersion', 1, 'id', a.slug, 'name', a.name, 'kind', 'integration', 'category', 'productivity',
         'version', '1.0.0', 'description', a.tagline, 'scopes', jsonb_build_array('contacts.read', 'contacts.write'),
         'surfaces', '[]'::jsonb, 'pricing', jsonb_build_object('model', 'free'), 'support', '{}'::jsonb,
         'connector', jsonb_build_object('type', 'client')),
       jsonb_build_object('schemaVersion', 1, 'key', a.slug, 'name', a.name, 'category', 'productivity', 'logo', null,
         'connector', jsonb_build_object('type', 'client', 'stores', '[]'::jsonb),
         'authFields', '[]'::jsonb, 'mapping', jsonb_build_object('mode', 'auto'),
         'setupInstructions', jsonb_build_array(
           jsonb_build_object('title', 'Install it', 'body', 'Open the store link on this page and install it.'),
           jsonb_build_object('title', 'Sign in', 'body', 'Each member signs in with their own account. Your role decides what you can do.'))),
       ARRAY['contacts.read', 'contacts.write']::text[], 'First version: the existing WaDesk extension behaviour.'
FROM marketplace_apps a WHERE a.slug IN ('chrome-extension', 'google-sheets')
  AND NOT EXISTS (SELECT 1 FROM marketplace_app_versions v WHERE v.app_id = a.id);
