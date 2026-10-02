-- paygw: what the port needs on top of the ported orders table, plus the two buyer permission keys.
-- Why this migration exists (TW-PAYGW-011, 026-028, 031, 035): Reference resolves a payment return by a gateway-specific query key and
-- falls back to the browser session, so a buyer who pays on another device gets "Order not found" although charged, and it never
-- guards a paid order against a second confirmation. Here every order carries its own opaque `return_token` (put in the return URL we
-- hand the provider), a `kind` (plan, add-on or wallet top-up share the table, as in Reference), the plan it buys by SLUG (the one plan
-- reference PLAN decided on; `package_id` points at the legacy Reference packages table and stays unused), the wallet grant as a column
-- instead of a key inside gateway_payload, and a client idempotency key so a double submit cannot create two orders.
-- Applied migrations are immutable, so all of it is additive.

ALTER TABLE orders
  ADD COLUMN kind text NOT NULL DEFAULT 'plan',
  ADD COLUMN plan_slug text,
  ADD COLUMN return_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  ADD COLUMN wallet_topup_minor bigint,
  ADD COLUMN idempotency_key text;

ALTER TABLE orders
  ADD CONSTRAINT chk_orders_kind CHECK (kind IN ('plan', 'addon', 'wallet_topup')),
  ADD CONSTRAINT chk_orders_status CHECK (status IN ('pending', 'awaiting_approval', 'paid', 'failed', 'cancelled', 'refunded')),
  ADD CONSTRAINT chk_orders_topup CHECK (kind <> 'wallet_topup' OR wallet_topup_minor > 0),
  ADD CONSTRAINT chk_orders_plan_slug CHECK (kind = 'wallet_topup' OR plan_slug IS NOT NULL),
  ADD CONSTRAINT chk_orders_period CHECK (billing_period IN ('monthly', 'yearly')),
  ADD CONSTRAINT uq_orders_return_token UNIQUE (return_token),
  ADD CONSTRAINT uq_orders_idempotency_key UNIQUE (org_id, idempotency_key);

-- The return and webhook receivers locate an order across tenants by the provider's own id; the existing index is per org.
CREATE INDEX idx_orders_gateway_order_id_any ON orders (gateway_order_id) WHERE gateway_order_id IS NOT NULL;
-- The buyer's own history, newest first.
CREATE INDEX idx_orders_user_created ON orders (org_id, user_id, created_at DESC, id DESC);

-- Capability keys. Operators use roles (Reference checks no finer key on the console routes either); these two gate the workspace side.
INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('paygw.checkout.create', 'Buy a plan, add-on or wallet top-up', 'billing', false),
  ('paygw.orders.read',     'View the workspace order history',    'billing', false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      supports_scope = EXCLUDED.supports_scope;

-- The locked Admin preset cannot be edited through the app (protect_locked_role): unlock, grant, relock, as the other domains do.
SELECT set_config('app.privileged', 'on', true);
UPDATE roles SET is_locked = false WHERE system_key = 'admin' AND is_locked;
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
  SELECT r.org_id, r.id, k.key, 'allow', 'all'
  FROM roles r
  CROSS JOIN (VALUES ('paygw.checkout.create'), ('paygw.orders.read')) AS k(key)
  WHERE r.system_key = 'admin'
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
UPDATE roles SET is_locked = true WHERE system_key = 'admin';
UPDATE organizations SET roles_version = roles_version + 1;
