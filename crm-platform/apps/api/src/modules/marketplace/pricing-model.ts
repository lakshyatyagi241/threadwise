import { sql } from 'drizzle-orm';
import {
  FREE_PRICING,
  daysUntil,
  deriveSubscriptionStatus,
  marketPackSlug,
  subscriptionActions,
  type MarketAppPricingModel,
  type MarketBillingMode,
  type MarketPricingView,
  type MarketSubscription,
  type MarketSubscriptionSource,
} from '@crm/contracts';
import { iso, toDate } from './sql-helpers';

type Raw = Record<string, unknown>;

/** What the operator decided an app costs, as stored on `marketplace_apps`. */
export interface AppPricingRow {
  pricingModel: MarketAppPricingModel;
  priceAmount: string | null;
  priceCurrency: string | null;
  annualAmount: string | null;
  billingMode: MarketBillingMode;
  priceLock: boolean;
  trialDays: number;
  purchasable: boolean;
  includedPlanFeature: string | null;
  includedMinPlan: string | null;
  priceChangedAt: Date | null;
  /** Plan feature keys a subscription grants (first-party apps only). */
  grantsPlanFeatures: string[];
  grandfatherExisting: boolean;
}

/** The pricing columns of `marketplace_apps` aliased `a`. */
export const APP_PRICING_COLUMNS_TEXT = `
  a.pricing_model, a.price_amount::text AS price_amount, a.price_currency, a.annual_amount::text AS annual_amount, a.trial_days,
  a.purchasable, a.included_plan_feature, a.included_min_plan, a.price_changed_at, a.grants_plan_features, a.grandfather_existing,
  a.billing_mode, a.price_lock`;
export const APP_PRICING_COLUMNS = sql.raw(APP_PRICING_COLUMNS_TEXT);

export function readAppPricing(r: Raw): AppPricingRow {
  return {
    pricingModel: (r.pricing_model as MarketAppPricingModel | undefined) ?? 'free',
    priceAmount: (r.price_amount as string | null | undefined) ?? null,
    priceCurrency: (r.price_currency as string | null | undefined) ?? null,
    annualAmount: (r.annual_amount as string | null | undefined) ?? null,
    billingMode: r.billing_mode === 'recurring' ? 'recurring' : 'one_time',
    priceLock: r.price_lock === true,
    trialDays: Number(r.trial_days ?? 0),
    purchasable: (r.purchasable as boolean | undefined) ?? true,
    includedPlanFeature: (r.included_plan_feature as string | null | undefined) ?? null,
    includedMinPlan: (r.included_min_plan as string | null | undefined) ?? null,
    priceChangedAt: toDate(r.price_changed_at),
    grantsPlanFeatures: (r.grants_plan_features as string[] | null | undefined) ?? [],
    grandfatherExisting: (r.grandfather_existing as boolean | undefined) ?? false,
  };
}

/** The operator's view of an app's pricing. `packSlug` is derived from the app's uuid, so it exists as soon as the app has been priced once. */
export function toPricingView(
  p: AppPricingRow,
  appUuid: string,
  packExists: boolean,
): MarketPricingView {
  if (p.pricingModel === 'free' && !packExists) return { ...FREE_PRICING };
  return {
    model: p.pricingModel,
    amount: p.priceAmount,
    currency: p.priceCurrency,
    annualAmount: p.annualAmount,
    billingMode: p.billingMode,
    priceLock: p.priceLock,
    trialDays: p.trialDays,
    purchasable: p.purchasable,
    includedPlanFeature: p.includedPlanFeature,
    includedMinPlan: p.includedMinPlan,
    priceChangedAt: iso(p.priceChangedAt),
    grantsPlanFeatures: p.grantsPlanFeatures,
    grandfatherExisting: p.grandfatherExisting,
    packSlug: packExists ? marketPackSlug(appUuid) : null,
  };
}

/** `plans.name` is at most 120 characters. */
export const packName = (appName: string): string => `${appName} (Marketplace)`.slice(0, 120);

// --- subscription rows ------------------------------------------------------------------------------------------------------------------

export interface SubscriptionRow {
  orgId: number;
  id: number;
  uuid: string;
  appId: number;
  packId: number;
  status: 'active' | 'lapsed';
  source: MarketSubscriptionSource;
  cancelAtPeriodEnd: boolean;
  amount: string | null;
  currency: string | null;
  /** How the last payment was bought; `amount` is its price for that period. */
  billingPeriod: 'monthly' | 'yearly';
  startedAt: Date;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  canceledAt: Date | null;
  lapsedAt: Date | null;
  renewals: number;
  compNote: string | null;
  autorenew: boolean;
  /** The next payment is `amount` whatever the listing costs now. */
  priceLocked: boolean;
  paymentFailedAt: Date | null;
  graceEndsAt: Date | null;
  lastRenewedAt: Date | null;
  autorenewStoppedAt: Date | null;
}

/** The subscription columns of `marketplace_subscriptions` aliased `s`, prefixed so they sit beside the app's in one row. */
export const SUBSCRIPTION_COLUMNS_TEXT = `
  s.org_id AS sub_org_id, s.id AS sub_id, s.uuid AS sub_uuid, s.app_id AS sub_app_id, s.pack_id AS sub_pack_id, s.status AS sub_status,
  s.source AS sub_source, s.cancel_at_period_end AS sub_cancel, s.amount::text AS sub_amount, s.currency AS sub_currency,
  s.started_at AS sub_started, s.current_period_end AS sub_end, s.trial_ends_at AS sub_trial_end, s.canceled_at AS sub_canceled,
  s.lapsed_at AS sub_lapsed, s.renewals_count AS sub_renewals, s.comp_note AS sub_comp_note,
  s.billing_period AS sub_period, s.price_locked AS sub_price_locked, s.autorenew AS sub_autorenew, s.payment_failed_at AS sub_payment_failed, s.grace_ends_at AS sub_grace_ends,
  s.last_renewed_at AS sub_last_renewed, s.autorenew_stopped_at AS sub_autorenew_stopped`;
export const SUBSCRIPTION_COLUMNS = sql.raw(SUBSCRIPTION_COLUMNS_TEXT);

/** The subscription of a joined row, or null when the left join found none. */
export function readSubscription(r: Raw): SubscriptionRow | null {
  if (r.sub_id === null || r.sub_id === undefined) return null;
  return {
    orgId: Number(r.sub_org_id),
    id: Number(r.sub_id),
    uuid: r.sub_uuid as string,
    appId: Number(r.sub_app_id),
    packId: Number(r.sub_pack_id),
    status: r.sub_status as SubscriptionRow['status'],
    source: r.sub_source as MarketSubscriptionSource,
    cancelAtPeriodEnd: r.sub_cancel as boolean,
    amount: (r.sub_amount as string | null) ?? null,
    currency: (r.sub_currency as string | null) ?? null,
    billingPeriod: r.sub_period === 'yearly' ? 'yearly' : 'monthly',
    startedAt: toDate(r.sub_started)!,
    currentPeriodEnd: toDate(r.sub_end),
    trialEndsAt: toDate(r.sub_trial_end),
    canceledAt: toDate(r.sub_canceled),
    lapsedAt: toDate(r.sub_lapsed),
    renewals: Number(r.sub_renewals),
    compNote: (r.sub_comp_note as string | null) ?? null,
    autorenew: r.sub_autorenew === true,
    priceLocked: r.sub_price_locked === true,
    paymentFailedAt: toDate(r.sub_payment_failed),
    graceEndsAt: toDate(r.sub_grace_ends),
    lastRenewedAt: toDate(r.sub_last_renewed),
    autorenewStoppedAt: toDate(r.sub_autorenew_stopped),
  };
}

/** Whether the platform is selling the app: it is paid, in a state a workspace can reach it in, and on sale (or this workspace already pays). */
export function onSale(
  p: AppPricingRow,
  appStatus: string,
  sub: Pick<SubscriptionRow, 'status'> | null,
): boolean {
  return (
    p.pricingModel === 'paid_monthly' &&
    (appStatus === 'published' || appStatus === 'hidden') &&
    (p.purchasable || sub?.status === 'active')
  );
}

/** What a workspace sees of its own subscription: the derived status, what it last paid, what the next payment will be, and what it may do. */
export function toSubscriptionView(
  sub: SubscriptionRow,
  pricing: AppPricingRow,
  appStatus: string,
  now: Date,
): MarketSubscription {
  const status = deriveSubscriptionStatus(
    {
      status: sub.status,
      source: sub.source,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      currentPeriodEnd: sub.currentPeriodEnd,
      paymentFailedAt: sub.paymentFailedAt,
      graceEndsAt: sub.graceEndsAt,
    },
    now,
  );
  const daysLeft = sub.currentPeriodEnd ? daysUntil(sub.currentPeriodEnd, now) : null;
  const paid = pricing.pricingModel === 'paid_monthly';
  // Renewing on its own only while a provider subscription is live and the person has not asked to stop it.
  const autoRenew = sub.autorenew && !sub.cancelAtPeriodEnd && sub.status === 'active';
  // A locked subscriber pays what they paid, whatever the listing costs now: there is no "price changed" to announce.
  const priceDiffers =
    paid &&
    sub.source === 'purchase' &&
    !sub.priceLocked &&
    ((sub.billingPeriod === 'yearly' && pricing.annualAmount !== null
      ? pricing.annualAmount !== sub.amount
      : pricing.priceAmount !== sub.amount) ||
      pricing.priceCurrency !== sub.currency);
  return {
    id: sub.uuid,
    status,
    source: sub.source,
    amount: sub.amount,
    currency: sub.currency,
    period: sub.billingPeriod,
    startedAt: sub.startedAt.toISOString(),
    currentPeriodEnd: iso(sub.currentPeriodEnd),
    trialEndsAt: iso(sub.trialEndsAt),
    canceledAt: iso(sub.canceledAt),
    lapsedAt: iso(sub.lapsedAt),
    renewals: sub.renewals,
    nextAmount: priceDiffers
      ? sub.billingPeriod === 'yearly' && pricing.annualAmount !== null
        ? pricing.annualAmount
        : pricing.priceAmount
      : null,
    nextCurrency: priceDiffers ? pricing.priceCurrency : null,
    autoRenew,
    priceLocked: sub.priceLocked,
    paymentFailedAt: iso(sub.paymentFailedAt),
    graceEndsAt: iso(sub.graceEndsAt),
    actions: subscriptionActions(status, sub.source, daysLeft, onSale(pricing, appStatus, sub), {
      autopayStopped: sub.autorenewStoppedAt !== null,
      autoRenewing: autoRenew,
    }),
  };
}
