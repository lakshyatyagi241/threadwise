-- marketplace: a paid app can renew by card on its own (BL-070).
-- Why: until now a paid app was a monthly prepaid term renewed by paying again. The payments domain already sells an add-on as an autopay
-- subscription (`plans.billing_mode = 'recurring'`, migration 20261022090000): the provider charges every cycle, the renewal notice
-- extends the add-on's own `workspace_addons.ends_at`, and a failed charge keeps the add-on alive for `billing.grace_days`. This migration
-- lets the operator choose, per listing, that the add-on which sells the app is such a pack, and gives the Marketplace's ledger the few
-- columns it needs to follow the provider (it follows the entitlement; it never grants it).
--
--  1. marketplace_apps.billing_mode: `one_time` (the default, a prepaid month renewed by paying again) or `recurring` (the card renews it).
--     It is copied to the app's add-on (`plans.billing_mode`) by the operator's pricing call. A free app is always `one_time`.
--  2. marketplace_subscriptions:
--       autorenew         a live provider subscription is going to charge this one again (set by the first autopay charge, cleared when
--                         the provider subscription ends for any reason). The page says "renews on <date>" only when this is true.
--       payment_failed_at the provider reported a failed renewal charge and has not recovered yet.
--       grace_ends_at     until when the app keeps working after that failure (the end of the paid period plus the grace days).
--       last_renewed_at   the last renewal the PROVIDER made (a manual renewal does not set it).
--       autorenew_stopped_at  the provider subscription was ended while the app was still paid (the workspace cancelled, the operator did,
--                         the provider did): a provider subscription cannot be revived, so taking the cancellation back is impossible
--                         and the page offers paying again instead. Cleared when a new autopay starts.
--     All five are written only on the privileged path, like the rest of the table.

ALTER TABLE marketplace_apps
  ADD COLUMN billing_mode text NOT NULL DEFAULT 'one_time',
  ADD CONSTRAINT chk_marketplace_apps_billing_mode CHECK (billing_mode IN ('one_time', 'recurring')),
  ADD CONSTRAINT chk_marketplace_apps_recurring_paid CHECK (billing_mode = 'one_time' OR pricing_model = 'paid_monthly');

ALTER TABLE marketplace_subscriptions
  ADD COLUMN autorenew         boolean NOT NULL DEFAULT false,
  ADD COLUMN payment_failed_at timestamptz,
  ADD COLUMN grace_ends_at     timestamptz,
  ADD COLUMN last_renewed_at   timestamptz,
  ADD COLUMN autorenew_stopped_at timestamptz,
  ADD CONSTRAINT chk_marketplace_subscriptions_grace CHECK (grace_ends_at IS NULL OR payment_failed_at IS NOT NULL),
  ADD CONSTRAINT chk_marketplace_subscriptions_autorenew CHECK (NOT autorenew OR source = 'purchase');
