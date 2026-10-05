-- ecom: capability keys for the Shopify and WooCommerce integrations.
-- Why this migration exists (WD-ECOM-003): WaDesk gated the routes on the workspace role and the plan features `integration_shopify`
-- and `integration_woocommerce`. Connecting a store hands over its credentials, and the automations, offers and win-back send
-- WhatsApp messages to customers on the merchant's behalf, so reading, connecting, mapping automations and broadcasting are separate
-- keys a workspace can hand out apart.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('ecom.read',               'View connected stores, orders and automations',     'ecommerce', false),
  ('ecom.connect',            'Connect, sync and disconnect a store',              'ecommerce', false),
  ('ecom.automations.manage', 'Map store events to WhatsApp templates',            'ecommerce', false),
  ('ecom.broadcast',          'Send offers and win-back messages to customers',    'ecommerce', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new
-- keys by unlocking, granting and relocking here. New organizations get every key in permission_defs when provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('ecom.read'),
    ('ecom.connect'),
    ('ecom.automations.manage'),
    ('ecom.broadcast')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
