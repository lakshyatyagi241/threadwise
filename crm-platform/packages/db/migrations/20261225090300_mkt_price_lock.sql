-- marketplace: a subscriber can keep the price they first paid (BL-071).
-- Why: today the next payment of an app is priced at the listing's price at that moment, so raising a price raises every subscriber's next
-- payment. The operator can now choose, per listing, to keep each subscriber on the price they first paid until their subscription ends
-- (grandfathering), and can release one subscriber from it.
--
--  1. marketplace_apps.price_lock: new subscriptions of this listing are locked at what they first pay. Turning it on also locks the
--     subscribers who pay today, at the amount their ledger row already holds; turning it off never unlocks anyone (the promise was made).
--  2. marketplace_subscriptions.price_locked: this subscription pays `amount` (in `currency`, for `billing_period`) at its next payment,
--     whatever the listing costs now. The lock holds while the subscription is in force and ends with it (a lapse), so subscribing again
--     after it ended is priced at the listing's price. Checkout reads it for the buyer's own subscription only.
-- Additive only.

ALTER TABLE marketplace_apps ADD COLUMN price_lock boolean NOT NULL DEFAULT false;

ALTER TABLE marketplace_subscriptions
  ADD COLUMN price_locked boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT chk_marketplace_subscriptions_price_lock CHECK (
    NOT price_locked OR (source = 'purchase' AND amount IS NOT NULL AND currency IS NOT NULL));
