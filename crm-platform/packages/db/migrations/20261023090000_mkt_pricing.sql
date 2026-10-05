-- marketplace: paid and free apps, billed monthly (spec docs/specs/marketplace-mini-apps-and-integrations.md section 6.6).
-- Why this migration exists: until now an app was free or gated behind a plan feature, and "pricing" was a free-text claim in the
-- developer's manifest. The owner wants the platform operator to decide, per listing, whether an app is free or paid, and a workspace to
-- buy a paid one on a monthly subscription. There is no second billing system here: a paid app is sold as a billing add-on, through the
-- checkout, gateways, orders, coupons and tax that already exist, and the add-on's purchase row (`workspace_addons`) is what entitles the
-- workspace, merged by AddonEntitlementService exactly like any other add-on.
--
--  1. marketplace_apps gets the pricing the platform operator sets. The manifest's `pricing` stays what the developer proposes; these
--     columns are the authority and only the operator API (privileged path) writes them. `price_amount` is per month in `price_currency`.
--     `annual_amount` is stored for the operator and the listing but annual billing is not built (backlog). `included_plan_feature` and
--     `included_min_plan` say which workspaces get the app without paying (their plan has the feature, or is at or above a plan).
--     `grants_plan_features` lists the existing plan feature keys a subscription to a FIRST-PARTY app grants (so a feature the product already
--     gates by plan, e.g. appointment booking, can become a paid app without changing a single gate): the add-on that sells the app grants
--     them next to its own key, and the plans domain's resolver counts them. `grandfather_existing` marks a listing whose existing users are to
--     be comped (an operator action, never automatic) so nobody who already has the feature loses it when it becomes an app.
--  2. plans.marketplace_app_id marks the billing add-on that sells one app. The operator's pricing call creates and keeps it in step with
--     the app (amount, currency, one month, grants one entitlement feature key). The add-ons console and the workspace add-on catalogue
--     leave these rows out (they are the Marketplace's), so nobody edits a price in the wrong place.
--  3. marketplace_subscriptions: one row per (workspace, app) for the whole relationship: purchase, trial or comp, whether it will renew,
--     when the paid period ends, when it lapsed. It is NOT the entitlement: `workspace_addons` is. The row records what the entitlement
--     means to the Marketplace (cancel at period end, lapsed, comped by whom) so the manage page, the operator's subscriptions view and
--     the lapse sweep have something to read. Writes are privileged (the checkout fulfilment, the operator API, the worker sweep); a
--     workspace changes its own row only through the two narrow functions below.
--  4. workspace_app_installations.paused_by_subscription: the installation was paused because the subscription ended, so that
--     resubscribing re-enables it and an admin's own pause is never undone by a payment.
--  5. marketplace_start_trial / marketplace_subscription_set_cancel: SECURITY DEFINER, so a workspace can start the app's free trial (it
--     grants a time-limited add-on row, which a tenant cannot write) and ask not to renew, and can do nothing else to these tables.
--  6. platform.market.pricing: the operator key for setting prices and comping or cancelling a subscription (money, so its own key).

-- --- 1. pricing on the listing -------------------------------------------------------------------------------------------------

ALTER TABLE marketplace_apps
  ADD COLUMN pricing_model          text NOT NULL DEFAULT 'free',
  ADD COLUMN price_amount           numeric(12, 2),
  ADD COLUMN price_currency         text,
  ADD COLUMN annual_amount          numeric(12, 2),
  ADD COLUMN trial_days             integer NOT NULL DEFAULT 0,
  ADD COLUMN purchasable            boolean NOT NULL DEFAULT true,
  ADD COLUMN included_plan_feature  text,
  ADD COLUMN included_min_plan      text REFERENCES plans (slug) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN price_changed_at       timestamptz,
  ADD COLUMN grants_plan_features   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN grandfather_existing   boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT chk_marketplace_apps_pricing_model CHECK (pricing_model IN ('free', 'paid_monthly')),
  ADD CONSTRAINT chk_marketplace_apps_trial_days CHECK (trial_days BETWEEN 0 AND 90),
  ADD CONSTRAINT chk_marketplace_apps_included_feature CHECK (
    included_plan_feature IS NULL OR included_plan_feature ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- A free app carries no price, trial or inclusion rule; a paid one has a positive monthly price in a currency.
  ADD CONSTRAINT chk_marketplace_apps_pricing CHECK (
    (pricing_model = 'free'
       AND price_amount IS NULL AND price_currency IS NULL AND annual_amount IS NULL AND trial_days = 0
       AND included_plan_feature IS NULL AND included_min_plan IS NULL
       AND cardinality(grants_plan_features) = 0 AND NOT grandfather_existing)
    OR
    (pricing_model = 'paid_monthly'
       AND ((price_amount > 0 AND price_currency ~ '^[A-Z]{3}$')
            -- a listing still being prepared may be paid with its price not set yet (publishing refuses it)
            OR (status IN ('draft', 'in_review') AND price_amount IS NULL AND price_currency IS NULL))
       AND (annual_amount IS NULL OR annual_amount > 0)));
-- Only a first-party app may grant plan features (a third-party app must never be able to switch on a core capability).
ALTER TABLE marketplace_apps
  ADD CONSTRAINT chk_marketplace_apps_grants_first_party CHECK (cardinality(grants_plan_features) = 0 OR first_party);
-- The catalogue list filters on it and the operator's subscriptions view groups by it.
CREATE INDEX idx_marketplace_apps_pricing ON marketplace_apps (pricing_model) WHERE pricing_model <> 'free';

-- --- 2. the add-on that sells one app --------------------------------------------------------------------------------------------

ALTER TABLE plans
  ADD COLUMN marketplace_app_id bigint REFERENCES marketplace_apps (id) ON DELETE CASCADE,
  ADD CONSTRAINT chk_plans_marketplace_app CHECK (marketplace_app_id IS NULL OR kind = 'addon');
CREATE UNIQUE INDEX uq_plans_marketplace_app ON plans (marketplace_app_id) WHERE marketplace_app_id IS NOT NULL;

-- --- 4. the installation paused by an ended subscription -------------------------------------------------------------------------

ALTER TABLE workspace_app_installations
  ADD COLUMN paused_by_subscription boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT chk_workspace_app_installations_paused CHECK (NOT paused_by_subscription OR status = 'disabled');

-- --- 3. subscriptions ---------------------------------------------------------------------------------------------------------------

CREATE TABLE marketplace_subscriptions (
  org_id                bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id                    bigint GENERATED BY DEFAULT AS IDENTITY,
  uuid                  uuid NOT NULL DEFAULT gen_random_uuid(),
  app_id                bigint NOT NULL REFERENCES marketplace_apps (id) ON DELETE RESTRICT,
  -- The billing add-on that carries the entitlement; its purchase rows are workspace_addons rows of this package.
  pack_id               bigint NOT NULL REFERENCES plans (id) ON DELETE RESTRICT,
  -- active: the workspace is entitled (its period end may still have passed: the sweep lapses it); lapsed: it ended.
  status                text NOT NULL DEFAULT 'active',
  -- purchase: paid through checkout; trial: the free trial the listing offers; comp: granted by the operator.
  source                text NOT NULL,
  -- The workspace asked not to renew (or uninstalled, or the app was withdrawn). The period already paid for runs to its end.
  cancel_at_period_end  boolean NOT NULL DEFAULT false,
  -- What the last payment was for at list price, per month (no tax, no coupon); the operator's MRR sums it. Null for a trial or a comp.
  amount                numeric(12, 2),
  currency              text,
  started_at            timestamptz NOT NULL DEFAULT now(),
  -- When the entitlement ends. Null: it has no end (a comp until revoked).
  current_period_end    timestamptz,
  trial_ends_at         timestamptz,
  canceled_at           timestamptz,
  lapsed_at             timestamptz,
  renewals_count        integer NOT NULL DEFAULT 0,
  comped_by_operator_id bigint REFERENCES platform_operators (id) ON DELETE SET NULL,
  comp_note             text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  row_version           integer NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, uuid),
  -- One row per workspace and app for good: resubscribing revives it, and a trial is offered only when there is no row.
  CONSTRAINT uq_marketplace_subscriptions_app UNIQUE (org_id, app_id),
  CONSTRAINT chk_marketplace_subscriptions_status CHECK (status IN ('active', 'lapsed')),
  CONSTRAINT chk_marketplace_subscriptions_source CHECK (source IN ('purchase', 'trial', 'comp')),
  CONSTRAINT chk_marketplace_subscriptions_amount CHECK (amount IS NULL OR amount >= 0),
  CONSTRAINT chk_marketplace_subscriptions_currency CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT chk_marketplace_subscriptions_renewals CHECK (renewals_count >= 0)
);
-- "The same uuid in two workspaces" cannot happen with gen_random_uuid(); the operator addresses a subscription by uuid alone.
CREATE UNIQUE INDEX uq_marketplace_subscriptions_uuid ON marketplace_subscriptions (uuid);
CREATE INDEX idx_marketplace_subscriptions_app ON marketplace_subscriptions (app_id, status);
CREATE INDEX idx_marketplace_subscriptions_org ON marketplace_subscriptions (org_id, status);
CREATE INDEX idx_marketplace_subscriptions_pack ON marketplace_subscriptions (pack_id);
CREATE INDEX idx_marketplace_subscriptions_comped_by ON marketplace_subscriptions (comped_by_operator_id);
-- The lapse sweep walks active rows by the end of their period.
CREATE INDEX idx_marketplace_subscriptions_due ON marketplace_subscriptions (current_period_end) WHERE status = 'active';
CREATE TRIGGER trg_marketplace_subscriptions_touch BEFORE UPDATE ON marketplace_subscriptions
  FOR EACH ROW EXECUTE FUNCTION touch_row();

ALTER TABLE marketplace_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_subscriptions FORCE  ROW LEVEL SECURITY;
-- A workspace reads its own rows. Only the privileged path writes (checkout fulfilment, the operator API, the worker sweep): a workspace
-- must not be able to mark itself comped, exactly as it cannot write its own add-on purchase.
CREATE POLICY tenant_read ON marketplace_subscriptions FOR SELECT
  USING (org_id = current_org_id() OR app_is_privileged());
CREATE POLICY platform_insert ON marketplace_subscriptions FOR INSERT WITH CHECK (app_is_privileged());
CREATE POLICY platform_update ON marketplace_subscriptions FOR UPDATE
  USING (app_is_privileged()) WITH CHECK (app_is_privileged());
CREATE POLICY platform_delete ON marketplace_subscriptions FOR DELETE USING (app_is_privileged());

-- --- 5. what a workspace may do to its own subscription ---------------------------------------------------------------------------

-- Starts the free trial of a paid app for the calling workspace: one time only (there is no row yet), on a published app that offers a
-- trial and is on sale. Grants the trial as a time-limited add-on purchase (no order), which is what entitles the workspace, and records
-- the subscription. Returns the new subscription's id, or NULL when the app does not qualify (the caller reports why).
CREATE OR REPLACE FUNCTION marketplace_start_trial(p_app_id bigint) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org     bigint := current_org_id();
  v_app     marketplace_apps%ROWTYPE;
  v_pack    bigint;
  v_ends    timestamptz;
  v_sub     bigint;
  prior     text := current_setting('app.privileged', true);
BEGIN
  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_app FROM marketplace_apps WHERE id = p_app_id;
  IF NOT FOUND OR v_app.status <> 'published' OR v_app.pricing_model <> 'paid_monthly'
     OR v_app.trial_days <= 0 OR NOT v_app.purchasable THEN
    RETURN NULL;
  END IF;
  SELECT id INTO v_pack FROM plans WHERE marketplace_app_id = p_app_id AND kind = 'addon';
  IF v_pack IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM marketplace_subscriptions s WHERE s.org_id = v_org AND s.app_id = p_app_id) THEN
    RETURN NULL;
  END IF;
  v_ends := now() + make_interval(days => v_app.trial_days);
  PERFORM set_config('app.privileged', 'on', true);
  INSERT INTO workspace_addons (org_id, package_id, order_id, status, starts_at, ends_at)
    VALUES (v_org, v_pack, NULL, 'active', now(), v_ends);
  INSERT INTO marketplace_subscriptions (org_id, app_id, pack_id, status, source, started_at, current_period_end, trial_ends_at)
    VALUES (v_org, p_app_id, v_pack, 'active', 'trial', now(), v_ends, v_ends)
    RETURNING id INTO v_sub;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
  RETURN v_sub;
END;
$$;
REVOKE ALL ON FUNCTION marketplace_start_trial(bigint) FROM PUBLIC;

-- Asks the calling workspace's subscription not to renew (or takes the request back). A comp is the operator's to end, so it is refused;
-- so is a subscription that has already lapsed. Returns whether a row changed.
CREATE OR REPLACE FUNCTION marketplace_subscription_set_cancel(p_app_id bigint, p_cancel boolean) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org   bigint := current_org_id();
  v_n     integer;
  prior   text := current_setting('app.privileged', true);
BEGIN
  IF v_org IS NULL THEN
    RETURN false;
  END IF;
  PERFORM set_config('app.privileged', 'on', true);
  UPDATE marketplace_subscriptions
     SET cancel_at_period_end = p_cancel,
         canceled_at = CASE WHEN p_cancel THEN coalesce(canceled_at, now()) ELSE NULL END
   WHERE org_id = v_org AND app_id = p_app_id AND status = 'active' AND source <> 'comp'
         AND cancel_at_period_end IS DISTINCT FROM p_cancel;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.privileged', coalesce(prior, 'off'), true);
  RETURN v_n > 0;
END;
$$;
REVOKE ALL ON FUNCTION marketplace_subscription_set_cancel(bigint, boolean) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app_user') THEN
    GRANT EXECUTE ON FUNCTION marketplace_start_trial(bigint) TO crm_app_user;
    GRANT EXECUTE ON FUNCTION marketplace_subscription_set_cancel(bigint, boolean) TO crm_app_user;
  END IF;
END
$$;
