-- marketplace: a paid app can be bought for a year (BL-072).
-- Why: the listing has stored a yearly price (`marketplace_apps.annual_amount`) since the first pricing build, but the add-on that sells the app
-- ignored the period: checkout priced it monthly and the purchase always ran one month. Now the add-on carries the yearly price, so checkout
-- can quote and charge it (a yearly price is the listing's own figure, not twelve months less a discount), the purchase runs one year, and a
-- card renewal asks the provider for a yearly cadence.
--
--  1. plans.annual_amount: only on an add-on; set from the listing by the operator's pricing call (null = no yearly option).
--  2. marketplace_subscriptions.billing_period: how the last payment was bought, so the page can say "per year" and the operator's monthly
--     recurring revenue counts a yearly payment as one twelfth. `amount` stays "what the last payment was at list price" for that period.
-- Additive only.

ALTER TABLE plans
  ADD COLUMN annual_amount numeric(12, 2),
  ADD CONSTRAINT chk_plans_annual_amount CHECK (annual_amount IS NULL OR (kind = 'addon' AND annual_amount > 0));

ALTER TABLE marketplace_subscriptions
  ADD COLUMN billing_period text NOT NULL DEFAULT 'monthly',
  ADD CONSTRAINT chk_marketplace_subscriptions_period CHECK (billing_period IN ('monthly', 'yearly'));
