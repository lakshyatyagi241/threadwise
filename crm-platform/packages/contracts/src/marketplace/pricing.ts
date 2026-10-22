import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { refundResponseSchema } from '../platform-payment-gateways/admin-billing';
import { PLAN_FEATURE_DEFS } from '../plans-subscriptions-trials/catalogue';
import { marketAppKindSchema, marketSlugSchema } from './enums';

/**
 * Paid and free apps (spec 6.6, docs/api/marketplace.md "Pricing and subscriptions").
 *
 * The platform operator decides, per listing, whether an app is free or paid and what it costs; the manifest's own `pricing` is only the
 * developer's proposal. A paid app is sold as a billing add-on through the existing checkout, and the add-on's purchase row is what
 * entitles a workspace (merged by the add-ons domain's entitlement service, like any add-on). Everything below is the vocabulary and the
 * pure rules for that: nothing here touches a database.
 */

// --- the vocabulary ---------------------------------------------------------------------------------------------------------------------

/** `free`: no charge. `paid_monthly`: a monthly price in one currency. (Annual billing is stored but not built: backlog.) */
export const MARKET_APP_PRICING_MODELS = ['free', 'paid_monthly'] as const;
export const marketAppPricingModelSchema = z.enum(MARKET_APP_PRICING_MODELS);
export type MarketAppPricingModel = z.infer<typeof marketAppPricingModelSchema>;

/**
 * How a paid app renews. `one_time`: a prepaid month, renewed by paying again (the default). `recurring`: the card renews it on its own through
 * the payment provider's subscription; the operator chooses per listing and the app's add-on carries the choice (`plans.billing_mode`).
 */
export const MARKET_BILLING_MODES = ['one_time', 'recurring'] as const;
export const marketBillingModeSchema = z.enum(MARKET_BILLING_MODES);
export type MarketBillingMode = z.infer<typeof marketBillingModeSchema>;

/** The period a paid app is bought for: a month, or a year at the listing's yearly price. */
export const MARKET_BILLING_PERIODS = ['monthly', 'yearly'] as const;
export const marketBillingPeriodSchema = z.enum(MARKET_BILLING_PERIODS);
export type MarketBillingPeriod = z.infer<typeof marketBillingPeriodSchema>;

export const MARKET_TRIAL_DAYS_MAX = 90;

/** A subscription's source: bought through checkout, the free trial of the listing, or granted by the operator. */
export const MARKET_SUBSCRIPTION_SOURCES = ['purchase', 'trial', 'comp'] as const;
export const marketSubscriptionSourceSchema = z.enum(MARKET_SUBSCRIPTION_SOURCES);
export type MarketSubscriptionSource = z.infer<typeof marketSubscriptionSourceSchema>;

/**
 * What a subscription is to a person. `canceling`: it will not renew but the paid period still runs. `past_due`: the card renewal failed and
 * the app keeps working for the grace days while the provider retries. `ended`: the period (and any grace) is over (the installation is
 * paused, its data kept). The stored status is only `active | lapsed`; this is derived by `deriveSubscriptionStatus`.
 */
export const MARKET_SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'comped',
  'canceling',
  'past_due',
  'ended',
] as const;
export const marketSubscriptionStatusSchema = z.enum(MARKET_SUBSCRIPTION_STATUSES);
export type MarketSubscriptionStatus = z.infer<typeof marketSubscriptionStatusSchema>;

/**
 * What the workspace can do about a paid app right now.
 *  free                   not a paid app
 *  included               the workspace's plan includes it: no subscription needed
 *  entitled               it holds a subscription (paid, trial or comp) that is in force
 *  subscription_required  paid, and it has none: Subscribe
 *  not_for_sale           paid, none, and the platform has stopped selling it
 */
export const MARKET_ACCESS_STATES = [
  'free',
  'included',
  'entitled',
  'subscription_required',
  'not_for_sale',
] as const;
export const marketAccessSchema = z.enum(MARKET_ACCESS_STATES);
export type MarketAccessState = z.infer<typeof marketAccessSchema>;

/**
 * Whether a paid app is on offer to a workspace, which the plan decides together with what the workspace owns. A plan makes a paid
 * Marketplace add-on VISIBLE; the workspace USES it only once it has bought it.
 *  open         not plan-gated: a free app, or one the plan includes (no purchase needed)
 *  visible      the workspace's plan enables the add-on and the workspace has not bought it: shown with its price, can subscribe, cannot use
 *  purchased    the workspace holds it (an active add-on purchase, trial or comp, an override, or an installation it already has): usable
 *  not_visible  neither enabled by the plan nor held: the app does not exist for the workspace (browse omits it, its page is a 404,
 *               install and subscribe refuse it). Never sent on a card, since a card is only built for what the workspace may see.
 * The access states above are unchanged: `visible` is `subscription_required` (or `not_for_sale`), `purchased` is `entitled`.
 */
export const MARKET_AVAILABILITY_STATES = ['open', 'visible', 'purchased', 'not_visible'] as const;
export const marketAvailabilitySchema = z.enum(MARKET_AVAILABILITY_STATES);
export type MarketAvailability = z.infer<typeof marketAvailabilitySchema>;

/**
 * Why a paid app costs a workspace nothing: its plan has the feature the operator named, or is at or above the plan the operator named, or
 * (`plan_grants`) the plan ITSELF carries every plan feature the app would grant (the app's own `mkt_` key aside), so the app adds nothing the
 * plan lacks. Installing the app stays free in all three cases.
 */
export const marketIncludedBySchema = z.enum(['plan_feature', 'min_plan', 'plan_grants']);
export type MarketIncludedBy = z.infer<typeof marketIncludedBySchema>;

/** How many days ahead of its end a paid period may be renewed (one more month is bought on top of the remaining time). */
export const MARKET_RENEW_AHEAD_DAYS = 45;
/** From how many days before its end the manage page offers "Renew now". */
export const MARKET_RENEW_NUDGE_DAYS = 7;

// --- the entitlement the add-on grants and the add-on's own slug ----------------------------------------------------------------------

/**
 * The feature key a paid app's add-on grants. The add-ons domain merges it onto the plan like any other flag, so one entitlement service
 * decides access. Slugs use dashes, flag keys underscores; `mkt_` keeps it clear of every core and module flag.
 */
export const marketEntitlementKey = (slug: string): string => `mkt_${slug.replace(/-/g, '_')}`;

/** Whether a granted feature key is an app's own subscription key (`mkt_<slug>`) rather than a plan feature the app grants. */
export const isMarketEntitlementKey = (key: string): boolean => key.startsWith('mkt_');

/**
 * The slug of the add-on that sells an app: fixed by the app's uuid (a plan slug is at most 32 characters, an app slug up to 48), so it
 * never has to change when the listing is renamed.
 */
export const marketPackSlug = (appUuid: string): string =>
  `mkt_${appUuid.replace(/-/g, '').toLowerCase().slice(0, 20)}`;
export const MARKET_PACK_SLUG_RE = /^mkt_[0-9a-f]{20}$/;

/**
 * Where a workspace pays for a paid app: the existing checkout page of the add-on. With `appSlug` the address carries where to come back to
 * (`?return=/marketplace/app/<slug>`), so the buyer lands on the app's page after paying instead of the order history.
 */
export const marketCheckoutPath = (
  packSlug: string,
  appSlug?: string,
  period: MarketBillingPeriod = 'monthly',
): string => {
  const q = [
    ...(appSlug ? [`return=${encodeURIComponent(`/marketplace/app/${appSlug}`)}`] : []),
    ...(period === 'yearly' ? ['period=yearly'] : []),
  ];
  return `/billing/checkout/${packSlug}${q.length > 0 ? `?${q.join('&')}` : ''}`;
};

// --- money ------------------------------------------------------------------------------------------------------------------------------

/** A decimal in major units, at most 10 integer digits and 2 decimals (the database's numeric(12,2)). A string end to end. */
export const MARKET_MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;
const moneySchema = z.string().trim().regex(MARKET_MONEY_RE, 'Use a number like 9 or 9.99.');
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code.');

/** "9" -> "9.00". Only for text that already matches MARKET_MONEY_RE. */
export function normaliseMarketMoney(value: string): string {
  const [whole = '0', frac = ''] = value.trim().split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${frac.padEnd(2, '0')}`;
}
export const marketMoneyIsPositive = (value: string): boolean =>
  MARKET_MONEY_RE.test(value.trim()) && Number(value) > 0;

// --- the operator sets the pricing ----------------------------------------------------------------------------------------------------

const featureKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, 'Use lowercase letters, digits and underscores.');
const planSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,32}$/, 'Use a plan id.');

interface PricingFields {
  model: MarketAppPricingModel;
  billingMode?: MarketBillingMode;
  priceLock?: boolean;
  amount?: string | null;
  currency?: string | null;
  annualAmount?: string | null;
  trialDays?: number;
  includedPlanFeature?: string | null;
  includedMinPlan?: string | null;
  grantsPlanFeatures?: readonly string[];
  grandfatherExisting?: boolean;
}

/**
 * The rules a pricing must satisfy, as the issues a form shows next to the field. A paid app has a positive monthly price and a
 * currency; a free one carries none of the paid fields (a price on a free app would be read as a promise).
 */
export function pricingIssues(p: PricingFields): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  if (p.model === 'free') {
    const leftovers: Array<[string, unknown]> = [
      ['amount', p.amount],
      ['currency', p.currency],
      ['annualAmount', p.annualAmount],
      ['includedPlanFeature', p.includedPlanFeature],
      ['includedMinPlan', p.includedMinPlan],
    ];
    for (const [path, v] of leftovers)
      if (v !== null && v !== undefined && v !== '')
        issues.push({ path, message: 'A free app has no price or inclusion rule.' });
    if ((p.trialDays ?? 0) !== 0)
      issues.push({ path: 'trialDays', message: 'A free app has no trial.' });
    if (p.billingMode === 'recurring')
      issues.push({ path: 'billingMode', message: 'A free app has nothing to renew.' });
    if (p.priceLock)
      issues.push({ path: 'priceLock', message: 'A free app has no price to keep.' });
    if ((p.grantsPlanFeatures?.length ?? 0) > 0)
      issues.push({ path: 'grantsPlanFeatures', message: 'Only a paid app grants plan features.' });
    if (p.grandfatherExisting)
      issues.push({
        path: 'grandfatherExisting',
        message: 'Only a paid app can comp its existing users.',
      });
    return issues;
  }
  if (p.amount === null || p.amount === undefined || !marketMoneyIsPositive(p.amount))
    issues.push({ path: 'amount', message: 'Set a monthly price above zero.' });
  if (!p.currency) issues.push({ path: 'currency', message: 'Choose a currency.' });
  if (
    p.annualAmount !== null &&
    p.annualAmount !== undefined &&
    !marketMoneyIsPositive(p.annualAmount)
  )
    issues.push({
      path: 'annualAmount',
      message: 'Set the yearly price above zero, or leave it empty.',
    });
  const grants = p.grantsPlanFeatures ?? [];
  if (new Set(grants).size !== grants.length)
    issues.push({ path: 'grantsPlanFeatures', message: 'List each plan feature once.' });
  if (p.grandfatherExisting && grants.length === 0)
    issues.push({
      path: 'grandfatherExisting',
      message: 'Name the plan features the app grants: those are what existing users already have.',
    });
  if (p.includedPlanFeature && grants.includes(p.includedPlanFeature))
    issues.push({
      path: 'includedPlanFeature',
      message: 'A feature the app grants cannot also be what includes the app.',
    });
  return issues;
}

/**
 * What the registry says a core plan feature is by default (a plan row that predates the key is taken to grant it), or null when the key is not
 * a core feature (a module-contributed key has no default: a plan grants it only when it says so).
 */
export function coreFeatureDefault(key: string): boolean | null {
  const d = PLAN_FEATURE_DEFS.find((x) => x.key === key);
  return d ? d.default : null;
}

/**
 * Whether an app may own (grant) a plan feature. A core feature whose registry default is ON is granted by every plan row that predates it,
 * so an app that "grants" it would sell what everyone already has: the default must be switched off first, in the same change that makes
 * the feature an app. A module-contributed key is off unless a plan or an add-on says so, so it is fine.
 */
export const planFeatureOwnableByApp = (key: string): boolean => coreFeatureDefault(key) !== true;

export const setMarketPricingSchema = z
  .object({
    rowVersion: z.number().int().positive(),
    model: marketAppPricingModelSchema,
    /** Monthly price in major units, e.g. "9.00". */
    amount: moneySchema.nullable().optional(),
    currency: currencySchema.nullable().optional(),
    /** Stored and shown to the operator; there is no annual checkout yet. */
    annualAmount: moneySchema.nullable().optional(),
    /** `recurring`: the card renews the app on its own. Applies to NEW subscriptions; one already running keeps the way it was bought. */
    billingMode: marketBillingModeSchema.default('one_time'),
    /**
     * Keep each subscriber on the price they first paid until their subscription ends (grandfathering). Subscribers who pay today are locked
     * at what they last paid when this is turned on; turning it off never unlocks anyone.
     */
    priceLock: z.boolean().default(false),
    trialDays: z.number().int().min(0).max(MARKET_TRIAL_DAYS_MAX).default(0),
    /** Off: no NEW subscriptions (workspaces that already subscribe may keep renewing). */
    purchasable: z.boolean().default(true),
    /** Workspaces whose plan (counting its add-ons) has this feature get the app free. */
    includedPlanFeature: featureKeySchema.nullable().optional(),
    /** Workspaces on this plan or any plan above it in the catalogue order get the app free. */
    includedMinPlan: planSlugSchema.nullable().optional(),
    /**
     * Existing plan feature keys a subscription grants: FIRST-PARTY apps only, and only features whose registry default is off. The app's
     * add-on carries them and the plans domain's resolver counts them, so the feature's current gates keep working unchanged.
     */
    grantsPlanFeatures: z.array(featureKeySchema).max(10).default([]),
    /** The operator may comp the workspaces that already have the granted features (the explicit grandfather action). */
    grandfatherExisting: z.boolean().default(false),
  })
  .strict()
  .superRefine((p, ctx) => {
    for (const i of pricingIssues(p))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i.path], message: i.message });
  });
export type SetMarketPricingInput = z.infer<typeof setMarketPricingSchema>;
export type SetMarketPricingRequest = z.input<typeof setMarketPricingSchema>;

/** The pricing of a listing as the operator sees and edits it. */
export const marketPricingViewSchema = z.object({
  model: marketAppPricingModelSchema,
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  annualAmount: z.string().nullable(),
  billingMode: marketBillingModeSchema,
  priceLock: z.boolean(),
  trialDays: z.number().int(),
  purchasable: z.boolean(),
  includedPlanFeature: z.string().nullable(),
  includedMinPlan: z.string().nullable(),
  priceChangedAt: z.string().datetime().nullable(),
  grantsPlanFeatures: z.array(z.string()),
  grandfatherExisting: z.boolean(),
  /** The slug of the add-on that sells it (null until the app is first priced). */
  packSlug: z.string().nullable(),
});
export type MarketPricingView = z.infer<typeof marketPricingViewSchema>;

export const FREE_PRICING: MarketPricingView = {
  model: 'free',
  amount: null,
  currency: null,
  annualAmount: null,
  billingMode: 'one_time',
  priceLock: false,
  trialDays: 0,
  purchasable: true,
  includedPlanFeature: null,
  includedMinPlan: null,
  priceChangedAt: null,
  grantsPlanFeatures: [],
  grandfatherExisting: false,
  packSlug: null,
};

/** What the Marketplace shows a workspace on a card and on the app page. */
export const marketCardPricingSchema = z.object({
  model: marketAppPricingModelSchema,
  /** Per month, major units. */
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  /** How the app renews: the card does it (`recurring`) or the workspace pays again (`one_time`). */
  billingMode: marketBillingModeSchema.optional(),
  /** The price of a year, major units, when the app can be bought yearly. Absent in an answer from before BL-072. */
  annualAmount: z.string().nullable().optional(),
  trialDays: z.number().int(),
  /** The workspace may start the free trial now (the app offers one and the workspace has never had a subscription to it). */
  trialAvailable: z.boolean(),
  access: marketAccessSchema,
  /** Why the workspace sees the app: see `MARKET_AVAILABILITY_STATES`. Always sent by the API. */
  availability: marketAvailabilitySchema.optional(),
  /** Set when `access` is `included`: which rule gave it. */
  includedBy: marketIncludedBySchema.nullable(),
  /** The checkout page of the add-on, for a paid app the workspace can subscribe to or renew. */
  checkoutPath: z.string().nullable(),
});
export type MarketCardPricing = z.infer<typeof marketCardPricingSchema>;

// --- pure rules ---------------------------------------------------------------------------------------------------------------------------

/**
 * Whether the workspace's plan makes a paid app free. `catalogue` is the plan slugs in catalogue order, lowest first; a workspace whose
 * paid plan has lapsed counts as on no plan here (it falls back to the free plan's entitlements, which the feature check already says).
 */
export function includedBy(f: {
  includedPlanFeature: string | null;
  planFeatureOn: boolean;
  includedMinPlan: string | null;
  orgPlanSlug: string | null;
  planLapsed: boolean;
  catalogue: readonly string[];
  /** The plan alone (no add-on, no app) already grants every plan feature the app grants; false when the app grants none. */
  planCarriesGrants?: boolean;
}): MarketIncludedBy | null {
  if (f.includedPlanFeature && f.planFeatureOn) return 'plan_feature';
  if (f.includedMinPlan && f.orgPlanSlug && !f.planLapsed) {
    const need = f.catalogue.indexOf(f.includedMinPlan);
    const have = f.catalogue.indexOf(f.orgPlanSlug);
    if (need >= 0 && have >= need) return 'min_plan';
  }
  if (f.planCarriesGrants) return 'plan_grants';
  return null;
}

export function accessFor(f: {
  model: MarketAppPricingModel;
  includedBy: MarketIncludedBy | null;
  entitled: boolean;
  purchasable: boolean;
  /** An active subscription may keep renewing after the operator stops selling to newcomers. */
  hasActiveSubscription: boolean;
}): MarketAccessState {
  if (f.model === 'free') return 'free';
  if (f.includedBy) return 'included';
  if (f.entitled) return 'entitled';
  return f.purchasable || f.hasActiveSubscription ? 'subscription_required' : 'not_for_sale';
}

/**
 * What the plan and the workspace's holdings say about a paid app's availability. `planVisible`: the workspace's plan enables the add-on
 * (true for a platform-owned workspace and for one with no plan row). `held`: the workspace bought it, or has an installation, a
 * subscription row or an override for it, so a plan that stops showing it never takes away what the workspace already has.
 */
export function availabilityFor(f: {
  model: MarketAppPricingModel;
  includedBy: MarketIncludedBy | null;
  entitled: boolean;
  planVisible: boolean;
  held: boolean;
}): MarketAvailability {
  if (f.model === 'free' || f.includedBy) return 'open';
  if (f.entitled) return 'purchased';
  if (f.planVisible || f.held) return 'visible';
  return 'not_visible';
}

/** A trial is offered once per workspace and app, to a workspace that has nothing yet, while the app is on sale. */
export const trialAvailable = (f: {
  model: MarketAppPricingModel;
  trialDays: number;
  purchasable: boolean;
  hasSubscriptionRow: boolean;
  access: MarketAccessState;
}): boolean =>
  f.model === 'paid_monthly' &&
  f.trialDays > 0 &&
  f.purchasable &&
  !f.hasSubscriptionRow &&
  f.access === 'subscription_required';

export interface SubscriptionFacts {
  /** The stored status. */
  status: 'active' | 'lapsed';
  source: MarketSubscriptionSource;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  /** The provider reported a failed renewal charge that has not recovered. */
  paymentFailedAt?: Date | null;
  /** Until when the app keeps working after that failure (the end of the paid period plus the grace days). */
  graceEndsAt?: Date | null;
}

/**
 * The status a person sees. A period that has run out is `ended` even before the sweep has recorded it, so no page ever shows a lapsed
 * subscription as active. A failed card renewal is `past_due` while the paid period or its grace days still run (the app keeps working)
 * and `ended` after. Precedence: ended, past_due, canceling, trialing or comped, active.
 */
export function deriveSubscriptionStatus(
  f: SubscriptionFacts,
  now: Date,
): MarketSubscriptionStatus {
  if (f.status === 'lapsed') return 'ended';
  if (f.paymentFailedAt) {
    const ends = [f.currentPeriodEnd, f.graceEndsAt ?? null]
      .filter((d): d is Date => d !== null)
      .map((d) => d.getTime());
    return ends.length > 0 && Math.max(...ends) <= now.getTime() ? 'ended' : 'past_due';
  }
  if (f.currentPeriodEnd !== null && f.currentPeriodEnd.getTime() <= now.getTime()) return 'ended';
  if (f.cancelAtPeriodEnd) return 'canceling';
  if (f.source === 'trial') return 'trialing';
  if (f.source === 'comp') return 'comped';
  return 'active';
}

export interface SubscriptionActions {
  /** Stop renewal (the period already paid for runs to its end). Not for a comp (the operator's) or an ended subscription. */
  canCancel: boolean;
  /** Take a cancellation back before the period ends. */
  canResume: boolean;
  /** Pay for another month now (the period is close to its end, or over). */
  canRenew: boolean;
}

/**
 * What the manage page offers. `daysLeft` is null for a subscription with no end.
 *  autopayStopped  the card renewal of this subscription was ended at the provider (a provider subscription cannot be revived), so a
 *                  cancellation cannot be taken back: the person pays again instead (`canRenew`, which then opens at any time before the end).
 *  autoRenewing    the card is going to renew it: there is nothing to renew by hand (paying again would start a second subscription).
 * A failed card renewal (`past_due`) offers paying now.
 */
export function subscriptionActions(
  status: MarketSubscriptionStatus,
  source: MarketSubscriptionSource,
  daysLeft: number | null,
  onSale: boolean,
  opts: { autopayStopped?: boolean; autoRenewing?: boolean } = {},
): SubscriptionActions {
  const live = status !== 'ended';
  const stopped = opts.autopayStopped === true;
  return {
    canCancel: live && status !== 'canceling' && source !== 'comp',
    canResume: status === 'canceling' && source !== 'comp' && !stopped,
    canRenew:
      onSale &&
      source !== 'comp' &&
      (status === 'ended' ||
        status === 'past_due' ||
        (status === 'canceling' && stopped) ||
        (opts.autoRenewing !== true && daysLeft !== null && daysLeft <= MARKET_RENEW_NUDGE_DAYS)),
  };
}

/**
 * The most a workspace may have paid ahead: a payment is refused while the period already paid for runs more than this far ahead
 * (so a stray second click cannot buy a year). `remainingDays` is null for a subscription with no end.
 */
export const mayPayAhead = (remainingDays: number | null): boolean =>
  remainingDays === null ? false : remainingDays <= MARKET_RENEW_AHEAD_DAYS;

export type PackPurchaseVerdict = 'ok' | 'unavailable' | 'not_for_sale' | 'included' | 'paid_ahead';

/**
 * Whether checkout may sell a workspace the add-on of a Marketplace app. The checkout asks this on the quote and on the order, so a
 * direct request is held to the same rules as the Marketplace page: the app must be on offer (published, or hidden but already the
 * workspace's) and paid; a workspace whose plan includes it has no reason to pay; the platform may have stopped selling to newcomers
 * (a workspace with an active subscription may still renew); and one cannot pay more than about two months ahead.
 */
export function packPurchaseVerdict(f: {
  /** The workspace can see the app at all (row-level security hides drafts, and hidden or killed apps it never installed). */
  visible: boolean;
  appStatus: string | null;
  pricingModel: MarketAppPricingModel | null;
  purchasable: boolean;
  subscriptionActive: boolean;
  included: boolean;
  /** Days left in the period already paid for; null when there is none or it has no end. */
  remainingDays: number | null;
}): PackPurchaseVerdict {
  if (
    !f.visible ||
    f.pricingModel !== 'paid_monthly' ||
    (f.appStatus !== 'published' && f.appStatus !== 'hidden')
  )
    return 'unavailable';
  if (f.included) return 'included';
  if (!f.purchasable && !f.subscriptionActive) return 'not_for_sale';
  if (f.remainingDays !== null && !mayPayAhead(f.remainingDays)) return 'paid_ahead';
  return 'ok';
}

/** Whole days from `now` to `end`, rounded up; never negative. */
export function daysUntil(end: Date, now: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}

// --- what a subscription looks like on the wire ---------------------------------------------------------------------------------------------

export const marketSubscriptionSchema = z.object({
  id: uuidSchema,
  status: marketSubscriptionStatusSchema,
  source: marketSubscriptionSourceSchema,
  /** What the last payment was at list price for its `period`; null for a trial or a comp. */
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  /** The period that payment was bought for. */
  period: marketBillingPeriodSchema,
  startedAt: z.string().datetime(),
  /** When access ends unless renewed; null for a subscription with no end. */
  currentPeriodEnd: z.string().datetime().nullable(),
  trialEndsAt: z.string().datetime().nullable(),
  canceledAt: z.string().datetime().nullable(),
  lapsedAt: z.string().datetime().nullable(),
  renewals: z.number().int(),
  /** The listing's price now, when it differs from `amount`: what the next payment will be. */
  nextAmount: z.string().nullable(),
  nextCurrency: z.string().nullable(),
  /** The card renews it on its own at the end of the period: the page says "renews on" (otherwise "paid until"). */
  autoRenew: z.boolean(),
  /** The next payment is `amount` whatever the listing costs now (grandfathered), until the subscription ends. */
  priceLocked: z.boolean(),
  /** The card renewal failed; the app keeps working until `graceEndsAt` while the provider retries. Null when nothing is wrong. */
  paymentFailedAt: z.string().datetime().nullable(),
  graceEndsAt: z.string().datetime().nullable(),
  actions: z.object({ canCancel: z.boolean(), canResume: z.boolean(), canRenew: z.boolean() }),
});
export type MarketSubscription = z.infer<typeof marketSubscriptionSchema>;

// --- workspace calls --------------------------------------------------------------------------------------------------------------------------

/** Subscribe: with `startTrial` start the free trial the listing offers, otherwise go and pay. */
export const subscribeAppSchema = z
  .object({
    startTrial: z.boolean().default(false),
    /** `yearly` needs a yearly price on the listing (`422` otherwise). Ignored for a trial. */
    period: marketBillingPeriodSchema.default('monthly'),
  })
  .strict();
export type SubscribeAppInput = z.infer<typeof subscribeAppSchema>;
export type SubscribeAppRequest = z.input<typeof subscribeAppSchema>;

export const MARKET_SUBSCRIBE_OUTCOMES = [
  'trial_started',
  'checkout',
  'included',
  'already_entitled',
  'free',
] as const;
export const marketSubscribeResultSchema = z.object({
  outcome: z.enum(MARKET_SUBSCRIBE_OUTCOMES),
  /** For `checkout`: where to pay (the existing checkout page of the add-on). */
  checkout: z.object({ packSlug: z.string(), path: z.string() }).nullable(),
  subscription: marketSubscriptionSchema.nullable(),
});
export type MarketSubscribeResult = z.infer<typeof marketSubscribeResultSchema>;

export const marketSubscriptionStateAnswerSchema = z.object({
  subscription: marketSubscriptionSchema,
});
export type MarketSubscriptionStateAnswer = z.infer<typeof marketSubscriptionStateAnswerSchema>;

/** The workspace's own subscriptions, newest first, each with its app. */
export const marketWorkspaceSubscriptionSchema = marketSubscriptionSchema.extend({
  app: z.object({
    id: uuidSchema,
    slug: marketSlugSchema,
    name: z.string(),
    kind: marketAppKindSchema,
    logo: z.string().nullable(),
  }),
  installationId: uuidSchema.nullable(),
});
export type MarketWorkspaceSubscription = z.infer<typeof marketWorkspaceSubscriptionSchema>;
export const marketWorkspaceSubscriptionListSchema = z.object({
  data: z.array(marketWorkspaceSubscriptionSchema),
});
export type MarketWorkspaceSubscriptionList = z.infer<typeof marketWorkspaceSubscriptionListSchema>;

// --- operator calls ---------------------------------------------------------------------------------------------------------------------------

const text = (max: number, min = 0) => z.string().trim().min(min).max(max);

/**
 * Releases one subscriber from their locked price: the next payment is the listing's price. A subscriber whose card renews on its own
 * keeps the old price at the provider, so their card renewal is ended at the end of the period they paid for and they subscribe again at
 * the new price (they are told).
 */
export const unlockSubscriptionPriceSchema = z.object({ reason: text(300, 5) }).strict();
export type UnlockSubscriptionPriceInput = z.infer<typeof unlockSubscriptionPriceSchema>;
export type UnlockSubscriptionPriceRequest = z.input<typeof unlockSubscriptionPriceSchema>;

export const MARKET_COMP_MAX_MONTHS = 36;

/** Gives a workspace a paid app free: for a number of months, or (`months: null`) until the operator ends it. */
export const compSubscriptionSchema = z
  .object({
    workspaceId: uuidSchema,
    months: z.number().int().min(1).max(MARKET_COMP_MAX_MONTHS).nullable().default(null),
    note: text(300, 5),
  })
  .strict();
export type CompSubscriptionInput = z.infer<typeof compSubscriptionSchema>;
export type CompSubscriptionRequest = z.input<typeof compSubscriptionSchema>;

/** Cancels a workspace's subscription: at the end of the period it has paid for, or right now. */
export const cancelOperatorSubscriptionSchema = z
  .object({ immediate: z.boolean().default(false), reason: text(300, 5) })
  .strict();
export type CancelOperatorSubscriptionInput = z.infer<typeof cancelOperatorSubscriptionSchema>;
export type CancelOperatorSubscriptionRequest = z.input<typeof cancelOperatorSubscriptionSchema>;

/**
 * Comps every workspace that already has one of the app's granted plan features through its plan or its overrides and has no subscription
 * to the app yet (the "grandfather" action for a feature that becomes a paid app). `dryRun` counts and lists without writing.
 */
export const grandfatherSubscriptionsSchema = z
  .object({
    months: z.number().int().min(1).max(MARKET_COMP_MAX_MONTHS).nullable().default(null),
    note: text(300, 5),
    dryRun: z.boolean().default(true),
  })
  .strict();
export type GrandfatherSubscriptionsInput = z.infer<typeof grandfatherSubscriptionsSchema>;
export type GrandfatherSubscriptionsRequest = z.input<typeof grandfatherSubscriptionsSchema>;

export const marketGrandfatherResultSchema = z.object({
  dryRun: z.boolean(),
  /** Workspaces that qualify (have a granted feature now and no subscription to the app). */
  matched: z.number().int(),
  /** Subscriptions created (0 for a dry run). */
  comped: z.number().int(),
  /** Up to 25 of the workspaces, by name, so the operator can look before running it for real. */
  sample: z.array(z.object({ id: uuidSchema, name: z.string() })),
});
export type MarketGrandfatherResult = z.infer<typeof marketGrandfatherResultSchema>;

// --- refunding the unused time (BL-077) --------------------------------------------------------------------------------------------------

/**
 * Returns the unused part of the last payment of one subscription through the payment provider (super admins with the pricing permission).
 * `dryRun` (the default) works the amount out and changes nothing; `endNow` also ends the subscription now once the refund went through.
 */
export const prorateSubscriptionSchema = z
  .object({
    /** 5 to 250 characters; a dry run (which changes nothing) may leave it empty. */
    reason: z.string().trim().max(250).default(''),
    dryRun: z.boolean().default(true),
    endNow: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.dryRun && v.reason.length < 5)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Give a reason of at least 5 characters.',
      });
  });
export type ProrateSubscriptionInput = z.infer<typeof prorateSubscriptionSchema>;
export type ProrateSubscriptionRequest = z.input<typeof prorateSubscriptionSchema>;

export const marketProrationSchema = z.object({
  subscriptionId: uuidSchema,
  workspace: z.object({ id: uuidSchema, name: z.string() }),
  app: z.object({ slug: marketSlugSchema, name: z.string() }),
  /** The currency of the payment; null when no payment through a gateway was found. */
  currency: z.string().nullable(),
  /** In minor units, as text (a payment can exceed what a double holds exactly). */
  paidMinor: z.string(),
  unusedMinor: z.string(),
  alreadyRefundedMinor: z.string(),
  /** What may be returned now: the unused share minus what was already returned, never more than is left of the payment. */
  refundableMinor: z.string(),
  periodEnd: z.string().datetime().nullable(),
  billingPeriod: marketBillingPeriodSchema,
  /** Where the payment was made: a one-time order, or a charge of the provider's subscription. */
  source: z.enum(['order', 'charge']).nullable(),
  dryRun: z.boolean(),
  /** The refund the payment provider answered (absent for a dry run or when nothing is owed). */
  refund: refundResponseSchema.nullable(),
  ended: z.boolean(),
});
export type MarketProration = z.infer<typeof marketProrationSchema>;

/** Returns every subscriber of a WITHDRAWN (killed) app the share of their last payment from the moment the app was withdrawn. */
export const refundWithdrawnAppSchema = z
  .object({
    reason: z.string().trim().max(250).default(''),
    dryRun: z.boolean().default(true),
    /** Continue after the last subscription of the previous run (`next` in its answer). */
    after: z
      .string()
      .regex(/^\d{1,15}$/)
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.dryRun && v.reason.length < 5)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Give a reason of at least 5 characters.',
      });
  });
export type RefundWithdrawnAppInput = z.infer<typeof refundWithdrawnAppSchema>;
export type RefundWithdrawnAppRequest = z.input<typeof refundWithdrawnAppSchema>;

export const marketWithdrawnRefundSchema = z.object({
  dryRun: z.boolean(),
  /** Subscriptions looked at in this run. */
  considered: z.number().int(),
  /** Of those, the ones owed something. */
  refundable: z.number().int(),
  refunded: z.number().int(),
  failed: z.number().int(),
  /** Nothing owed: paid through no gateway, the period over, or already returned. */
  skipped: z.number().int(),
  hasMore: z.boolean(),
  /** Pass as `after` to continue. */
  next: z.string().nullable(),
  /** The money, per currency, in minor units as text (never added across currencies). */
  totals: z.array(z.object({ currency: z.string(), amountMinor: z.string() })),
  sample: z.array(
    z.object({
      workspace: z.string(),
      amountMinor: z.string(),
      currency: z.string(),
      outcome: z.enum(['would_refund', 'refunded', 'failed']),
    }),
  ),
});
export type MarketWithdrawnRefund = z.infer<typeof marketWithdrawnRefundSchema>;

export const marketOperatorSubscriptionSchema = z.object({
  id: uuidSchema,
  app: z.object({ id: uuidSchema, slug: marketSlugSchema, name: z.string() }),
  workspace: z.object({ id: uuidSchema, name: z.string() }),
  status: marketSubscriptionStatusSchema,
  source: marketSubscriptionSourceSchema,
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  startedAt: z.string().datetime(),
  currentPeriodEnd: z.string().datetime().nullable(),
  trialEndsAt: z.string().datetime().nullable(),
  canceledAt: z.string().datetime().nullable(),
  lapsedAt: z.string().datetime().nullable(),
  renewals: z.number().int(),
  period: marketBillingPeriodSchema,
  priceLocked: z.boolean(),
  cancelAtPeriodEnd: z.boolean(),
  autoRenew: z.boolean(),
  paymentFailedAt: z.string().datetime().nullable(),
  graceEndsAt: z.string().datetime().nullable(),
  compNote: z.string().nullable(),
  compBy: z.string().nullable(),
});
export type MarketOperatorSubscription = z.infer<typeof marketOperatorSubscriptionSchema>;

export const marketOperatorSubscriptionListQuerySchema = z.object({
  /** An app's uuid or slug. */
  app: z.union([uuidSchema, marketSlugSchema]).optional(),
  status: marketSubscriptionStatusSchema.optional(),
  source: marketSubscriptionSourceSchema.optional(),
  /** Part of the workspace's name. */
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(500).optional(),
});
export type MarketOperatorSubscriptionListQuery = z.infer<
  typeof marketOperatorSubscriptionListQuerySchema
>;
export const marketOperatorSubscriptionListSchema = z.object({
  data: z.array(marketOperatorSubscriptionSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int(),
  }),
});
export type MarketOperatorSubscriptionList = z.infer<typeof marketOperatorSubscriptionListSchema>;

/** Per app: who subscribes in what state, and the monthly recurring revenue per currency (list price, no tax or coupons, no trial or comp). */
export const marketSubscriptionSummaryRowSchema = z.object({
  appId: uuidSchema,
  slug: marketSlugSchema,
  name: z.string(),
  pricing: z.object({
    model: marketAppPricingModelSchema,
    amount: z.string().nullable(),
    currency: z.string().nullable(),
  }),
  counts: z.object({
    active: z.number().int(),
    trialing: z.number().int(),
    comped: z.number().int(),
    canceling: z.number().int(),
    pastDue: z.number().int(),
    ended: z.number().int(),
    total: z.number().int(),
  }),
  mrr: z.array(z.object({ currency: z.string(), amount: z.string() })),
});
export type MarketSubscriptionSummaryRow = z.infer<typeof marketSubscriptionSummaryRowSchema>;
export const marketSubscriptionSummarySchema = z.object({
  data: z.array(marketSubscriptionSummaryRowSchema),
  /** MRR over every app, per currency (never converted). */
  totals: z.array(z.object({ currency: z.string(), amount: z.string() })),
});
export type MarketSubscriptionSummary = z.infer<typeof marketSubscriptionSummarySchema>;
