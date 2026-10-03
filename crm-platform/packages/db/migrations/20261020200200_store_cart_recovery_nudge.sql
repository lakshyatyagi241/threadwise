-- store: when an abandoned-cart nudge is due and when it went out (WD-STORE-015).
-- Why this migration exists: WaDesk registered a one-off message on its Node scheduler and kept the scheduler's ids in
-- scheduled_ids. Here the worker sweeps the table itself (no scheduler domain yet), so the row has to say when its nudge is due
-- and whether it was sent; scheduled_ids stays for the shape WaDesk had.

ALTER TABLE storefront_cart_recoveries
  ADD COLUMN nudge_at timestamptz,
  ADD COLUMN nudged_at timestamptz;

CREATE INDEX idx_storefront_cart_recoveries_due
  ON storefront_cart_recoveries (nudge_at)
  WHERE status = 'active' AND nudged_at IS NULL;
