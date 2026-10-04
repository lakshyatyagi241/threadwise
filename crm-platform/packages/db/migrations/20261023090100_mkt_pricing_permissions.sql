-- marketplace pricing: the operator key for money decisions (see 20261023090000_mkt_pricing.sql).
-- Why a key of its own: `platform.market.manage` runs the catalogue and `platform.market.review` decides what is published; setting what an
-- app costs, comping a workspace and cancelling a paid subscription move money, so they are a third decision a super admin can hand to
-- someone without also letting them publish or kill an app. Reading the subscriptions view needs any of the three.
--
--   platform.market.pricing   set an app's price and inclusion rule, comp a workspace, cancel a workspace's subscription
--
-- Workspaces need no new key: subscribing, cancelling and resubscribing ride `market.apps.install` (they change what is installed),
-- and the payment itself is checkout's own `paygw.checkout.create`.
INSERT INTO platform_permissions (name, is_system) VALUES
  ('platform.market.pricing', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM platform_roles r JOIN platform_permissions p ON p.name::text = 'platform.market.pricing'
WHERE r.name IN ('Super Admin', 'Admin')
ON CONFLICT DO NOTHING;

-- The cached per-operator permission sets are keyed by this version.
UPDATE platform_settings SET value = to_jsonb(coalesce((value #>> '{}')::int, 0) + 1) WHERE key = 'rbac.version';
