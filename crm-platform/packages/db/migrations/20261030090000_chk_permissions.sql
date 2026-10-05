-- chk: capability keys for the merchant side of the store (orders, coupons, customers, groups, shared gateway, payments).
-- Why this migration exists: WaDesk put every /store/* screen behind the workspace "admin" role and nothing finer. Each area gets keys
-- here so a workspace can let support staff work orders without seeing the payment gateway keys, or let a bookkeeper see payments
-- without changing an order. Reading and changing are separate keys; deleting an order and saving gateway keys are the sensitive ones.
--
-- Who holds them: the Owner and Admin presets get every new key by the trigger on `permission_defs` (20261013100000), so existing
-- workspaces are covered by this insert and new ones by provisioning (the WaDesk admin loses nothing). No other preset holds them by
-- default: a workspace widens that in its role editor.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('store.orders.read',       'View store orders and their payments',                                        'store', false),
  ('store.orders.manage',     'Change an order status, send payment links and create an invoice from an order', 'store', false),
  ('store.orders.delete',     'Delete store orders',                                                          'store', false),
  ('store.coupons.read',      'View discount codes and where they were used',                                 'store', false),
  ('store.coupons.manage',    'Create, edit, switch and delete discount codes',                               'store', false),
  ('store.customers.read',    'View saved customers with their order totals',                                 'store', false),
  ('store.customers.manage',  'Add, edit and remove saved customers',                                         'store', false),
  ('store.groups.read',       'View the WhatsApp group directory',                                            'store', false),
  ('store.groups.manage',     'Set and clear group ordering codes',                                           'store', false),
  ('store.gateways.read',     'View payment gateways (credentials are never shown)',                          'store', false),
  ('store.gateways.manage',   'Save, test, enable, default and remove payment gateway credentials',           'store', false),
  ('store.payments.view',     'View the store payments overview',                                             'store', false),
  ('store.payments.manage',   'Change WhatsApp Pay configurations',                                           'store', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

SELECT set_config('app.privileged', 'on', true);
UPDATE organizations SET roles_version = roles_version + 1;
