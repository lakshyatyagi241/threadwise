-- bsp: capability keys for the customer billing choice.
-- Why this migration exists (WD-BSP-011): WaDesk gated "who bills me for messages" on the workspace admin role. Here it is a
-- capability a workspace can hand out (bsp.billing.manage) next to a read key for the card that shows the current mode.
-- The operator console routes carry no key: they are guarded by operator roles, not by workspace grants.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('bsp.billing.read',   'View how messages are billed',   'billing', false),
  ('bsp.billing.manage', 'Choose how messages are billed', 'billing', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role), so existing organizations get the new keys by
-- unlocking, granting and relocking here, as the contacts, deals and tasks migrations do. New organizations get every key in
-- permission_defs when they are provisioned.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES ('bsp.billing.read'), ('bsp.billing.manage')) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
