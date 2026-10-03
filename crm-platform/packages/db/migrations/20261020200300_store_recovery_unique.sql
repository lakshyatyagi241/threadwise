-- store: one active cart recovery per shop and phone, and a unique order tracking token (WD-STORE-015, 017; decision D-12).
--
-- Why this migration exists: WaDesk kept "one active recovery per phone and shop" in PHP only, so two beacons arriving together
-- could both insert. The partial unique index makes the database decide; the nudge worker now moves a fired row to 'sent', so the
-- same phone can start a new recovery later (WaDesk left the row 'active' forever and blocked it).
--
-- The tracking page finds an order by (shop, token), and the token is the only access control, so two orders must never share
-- one. wa_orders belongs to checkout-orders-merchant-payments (CHK), which created only a plain index on the token; this adds
-- the unique one next to it. Partial: orders from other channels carry no token.

CREATE UNIQUE INDEX uq_storefront_cart_recoveries_active
  ON storefront_cart_recoveries (org_id, storefront_id, customer_phone)
  WHERE status = 'active';

CREATE UNIQUE INDEX uq_wa_orders_recovery_token
  ON wa_orders (org_id, recovery_token)
  WHERE recovery_token IS NOT NULL;
