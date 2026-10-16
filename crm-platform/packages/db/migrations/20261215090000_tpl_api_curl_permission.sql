-- Message templates: a separate permission for the "Send with the API (cURL)" example on an approved template. The example is only
-- shown to people who hold it AND can read API keys (api.keys.read), and tells them to create a key first when the workspace has none.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('tpl.templates.api_curl', 'View the API cURL example of WhatsApp message templates', 'templates', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new
-- key by unlocking, granting and relocking here. New organizations get every key in permission_defs when provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, 'tpl.templates.api_curl', 'allow', 'all'
  FROM roles r
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
