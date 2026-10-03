-- paygw: what the operator billing screens need on top of the orders table (WD-PAYGW-037..046).
-- Why: WaDesk's "manual invoice" is an order stamped gateway_slug = 'manual' whose description lives only in the gateway payload and
-- is never printed. Here a manual invoice is its own order kind with a real `description` column, no plan, and is excluded from
-- plan/add-on/wallet logic. The admin lists filter and sort the whole table across workspaces, so they get indexes of their own.
-- Applied migrations are immutable, so this is a new file. RLS is untouched: `orders` keeps its tenant_isolation policy (USING and
-- WITH CHECK admit the privileged flag the operator console uses through PaygwStore).

ALTER TABLE orders ADD COLUMN description text;

ALTER TABLE orders DROP CONSTRAINT chk_orders_kind;
ALTER TABLE orders ADD CONSTRAINT chk_orders_kind CHECK (kind IN ('plan', 'addon', 'wallet_topup', 'manual'));

ALTER TABLE orders DROP CONSTRAINT chk_orders_plan_slug;
ALTER TABLE orders ADD CONSTRAINT chk_orders_plan_slug CHECK (kind IN ('wallet_topup', 'manual') OR plan_slug IS NOT NULL);

ALTER TABLE orders ADD CONSTRAINT chk_orders_manual_description
  CHECK (kind <> 'manual' OR (description IS NOT NULL AND length(btrim(description)) > 0));

-- The lists are newest first across every workspace, windowed by created_at; the KPIs window by paid_at.
CREATE INDEX idx_orders_created_all ON orders (created_at DESC, id DESC);
CREATE INDEX idx_orders_paid_at_paid ON orders (paid_at) WHERE status = 'paid';
-- The awaiting-approval queue (offline payments with a proof).
CREATE INDEX idx_orders_proof_queue ON orders (proof_submitted_at DESC)
  WHERE proof_submitted_at IS NOT NULL AND status IN ('pending', 'awaiting_approval');
