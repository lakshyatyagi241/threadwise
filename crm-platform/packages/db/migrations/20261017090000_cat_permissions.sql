-- cat: capability keys for the WhatsApp catalog, product list, collections and review moderation.
-- Why this migration exists (TW-CAT-001): Reference put every catalog and product route behind the workspace "admin" role and
-- the access_wa_storefront plan flag, and nothing finer. Here each area has its own key so a role can be given the product
-- list without the Meta connection, but the locked Admin preset (the Reference workspace admin) gets all of them, so a Reference
-- admin loses nothing. Keys are workspace-level toggles, not record-level: supports_scope is false everywhere.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('cat.catalog.read',       'View the WhatsApp catalog area',                'cat', false),
  ('cat.catalog.manage',     'Connect, sync and configure the Meta catalog',  'cat', false),
  ('cat.catalog.send',       'Send catalog messages and products to numbers', 'cat', false),
  ('cat.collections.manage', 'Create, edit and delete product collections',   'cat', false),
  ('cat.products.read',      'View products',                                 'cat', false),
  ('cat.products.create',    'Create products',                               'cat', false),
  ('cat.products.update',    'Edit products',                                 'cat', false),
  ('cat.products.delete',    'Delete products',                               'cat', false),
  ('cat.reviews.read',       'View product reviews',                          'cat', false),
  ('cat.reviews.moderate',   'Approve, reject and delete product reviews',    'cat', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new keys
-- by unlocking, granting and relocking here, as the tasks and deals migrations do. New organizations get every key in
-- permission_defs when they are provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES
    ('cat.catalog.read'), ('cat.catalog.manage'), ('cat.catalog.send'), ('cat.collections.manage'),
    ('cat.products.read'), ('cat.products.create'), ('cat.products.update'), ('cat.products.delete'),
    ('cat.reviews.read'), ('cat.reviews.moderate')
  ) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
