import { describe, expect, it } from 'vitest';
import {
  MARKET_PACK_SLUG_RE,
  MARKET_RENEW_AHEAD_DAYS,
  accessFor,
  compSubscriptionSchema,
  daysUntil,
  deriveSubscriptionStatus,
  includedBy,
  marketCheckoutPath,
  marketEntitlementKey,
  marketPackSlug,
  mayPayAhead,
  normaliseMarketMoney,
  coreFeatureDefault,
  planFeatureOwnableByApp,
  PLAN_FEATURE_DEFS,
  packPurchaseVerdict,
  pricingIssues,
  setMarketPricingSchema,
  subscribeAppSchema,
  subscriptionActions,
  trialAvailable,
  cancelOperatorSubscriptionSchema,
} from '@crm/contracts';
import {
  mergeFeature,
  type PlanFacts,
} from '../../../src/modules/addons-extension-registry/entitlement-merge';
import { termBase } from '../../../src/modules/addons-extension-registry/addon-grants';
import {
  onSale,
  toPricingView,
  toSubscriptionView,
  type AppPricingRow,
  type SubscriptionRow,
} from '../../../src/modules/marketplace/pricing-model';

const paid: AppPricingRow = {
  pricingModel: 'paid_monthly',
  priceAmount: '9.00',
  priceCurrency: 'USD',
  annualAmount: null,
  billingMode: 'one_time',
  priceLock: false,
  trialDays: 14,
  purchasable: true,
  includedPlanFeature: null,
  includedMinPlan: null,
  priceChangedAt: null,
  grantsPlanFeatures: [],
  grandfatherExisting: false,
};
const sub = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  orgId: 1,
  id: 2,
  uuid: '8a6f0c3e-3b8e-4d0e-8f43-0d0f3f3f3f3f',
  appId: 3,
  packId: 4,
  status: 'active',
  source: 'purchase',
  cancelAtPeriodEnd: false,
  amount: '9.00',
  currency: 'USD',
  billingPeriod: 'monthly',
  startedAt: new Date('2026-10-01T00:00:00Z'),
  currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
  trialEndsAt: null,
  canceledAt: null,
  lapsedAt: null,
  renewals: 0,
  compNote: null,
  autorenew: false,
  priceLocked: false,
  paymentFailedAt: null,
  graceEndsAt: null,
  lastRenewedAt: null,
  autorenewStoppedAt: null,
  ...over,
});
const NOW = new Date('2026-10-10T00:00:00Z');

describe('pricing validation (what the operator may save)', () => {
  const base = { rowVersion: 1, model: 'paid_monthly' as const, amount: '9', currency: 'USD' };

  it('accepts a paid app with a price and a currency, and defaults the rest', () => {
    const r = setMarketPricingSchema.parse(base);
    expect(r).toMatchObject({ trialDays: 0, purchasable: true, model: 'paid_monthly' });
  });

  it('refuses a paid app without a positive price or a currency, naming the field', () => {
    for (const body of [
      { ...base, amount: undefined },
      { ...base, amount: '0' },
      { ...base, amount: '0.00' },
      { ...base, currency: undefined },
    ]) {
      const r = setMarketPricingSchema.safeParse(body);
      expect(r.success).toBe(false);
    }
    const issues = pricingIssues({ model: 'paid_monthly', amount: '0', currency: null });
    expect(issues.map((i) => i.path).sort()).toEqual(['amount', 'currency']);
  });

  it('refuses money that is not a decimal with at most two places, a negative price and a long number', () => {
    for (const amount of ['9.999', '-1', '1e3', 'free', '12345678901', '9,00', '']) {
      expect(setMarketPricingSchema.safeParse({ ...base, amount }).success, amount).toBe(false);
    }
    for (const amount of ['0.01', '9', '9.9', '99.50', '9999999999.99']) {
      expect(setMarketPricingSchema.safeParse({ ...base, amount }).success, amount).toBe(true);
    }
  });

  it('upper-cases the currency and refuses anything that is not three letters', () => {
    expect(setMarketPricingSchema.parse({ ...base, currency: 'inr' }).currency).toBe('INR');
    expect(setMarketPricingSchema.safeParse({ ...base, currency: 'RUPEE' }).success).toBe(false);
    expect(setMarketPricingSchema.safeParse({ ...base, currency: 'U1D' }).success).toBe(false);
  });

  it('bounds the trial to 0..90 whole days', () => {
    expect(setMarketPricingSchema.safeParse({ ...base, trialDays: 90 }).success).toBe(true);
    expect(setMarketPricingSchema.safeParse({ ...base, trialDays: 91 }).success).toBe(false);
    expect(setMarketPricingSchema.safeParse({ ...base, trialDays: -1 }).success).toBe(false);
    expect(setMarketPricingSchema.safeParse({ ...base, trialDays: 7.5 }).success).toBe(false);
  });

  it('the operator chooses per listing whether the card renews the app; a free app has nothing to renew', () => {
    const base = { rowVersion: 1, model: 'paid_monthly', amount: '9', currency: 'USD' };
    expect(setMarketPricingSchema.parse(base).billingMode).toBe('one_time');
    expect(setMarketPricingSchema.parse({ ...base, billingMode: 'recurring' }).billingMode).toBe(
      'recurring',
    );
    expect(setMarketPricingSchema.safeParse({ ...base, billingMode: 'weekly' }).success).toBe(
      false,
    );
    const free = setMarketPricingSchema.safeParse({
      rowVersion: 1,
      model: 'free',
      billingMode: 'recurring',
    });
    expect(free.success).toBe(false);
    expect(pricingIssues({ model: 'free', billingMode: 'recurring' })).toEqual([
      { path: 'billingMode', message: 'A free app has nothing to renew.' },
    ]);
  });

  it('a free app carries no price, trial or inclusion rule', () => {
    expect(setMarketPricingSchema.safeParse({ rowVersion: 1, model: 'free' }).success).toBe(true);
    for (const extra of [
      { amount: '9.00' },
      { currency: 'USD' },
      { annualAmount: '90.00' },
      { trialDays: 7 },
      { includedPlanFeature: 'analytics' },
      { includedMinPlan: 'growth' },
    ]) {
      const r = setMarketPricingSchema.safeParse({ rowVersion: 1, model: 'free', ...extra });
      expect(r.success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('Subscribe takes a period, monthly unless the person chose a year', () => {
    expect(subscribeAppSchema.parse({})).toEqual({ startTrial: false, period: 'monthly' });
    expect(subscribeAppSchema.parse({ period: 'yearly' }).period).toBe('yearly');
    expect(subscribeAppSchema.safeParse({ period: 'weekly' }).success).toBe(false);
    expect(marketCheckoutPath('mkt_x', 'quote-pro', 'yearly')).toBe(
      '/billing/checkout/mkt_x?return=%2Fmarketplace%2Fapp%2Fquote-pro&period=yearly',
    );
    expect(marketCheckoutPath('mkt_x')).toBe('/billing/checkout/mkt_x');
  });

  it('the optional yearly price must be positive when given', () => {
    expect(setMarketPricingSchema.safeParse({ ...base, annualAmount: '90' }).success).toBe(true);
    expect(setMarketPricingSchema.safeParse({ ...base, annualAmount: '0' }).success).toBe(false);
    expect(setMarketPricingSchema.safeParse({ ...base, annualAmount: null }).success).toBe(true);
  });

  it('names an inclusion rule by plan feature key or by plan id, and refuses odd text', () => {
    expect(
      setMarketPricingSchema.safeParse({ ...base, includedPlanFeature: 'chatbot_widgets' }).success,
    ).toBe(true);
    expect(
      setMarketPricingSchema.safeParse({ ...base, includedPlanFeature: 'Chatbot Widgets' }).success,
    ).toBe(false);
    expect(setMarketPricingSchema.safeParse({ ...base, includedMinPlan: 'scale' }).success).toBe(
      true,
    );
    expect(
      setMarketPricingSchema.safeParse({ ...base, includedMinPlan: 'Big Plan!' }).success,
    ).toBe(false);
  });

  it('unknown keys are refused: an operator cannot smuggle a column in', () => {
    expect(setMarketPricingSchema.safeParse({ ...base, pricing_model: 'free' }).success).toBe(
      false,
    );
  });

  it('comp and operator cancel need a real note and bounded months', () => {
    const ws = '8a6f0c3e-3b8e-4d0e-8f43-0d0f3f3f3f3f';
    expect(
      compSubscriptionSchema.parse({ workspaceId: ws, note: 'Launch partner' }).months,
    ).toBeNull();
    expect(compSubscriptionSchema.safeParse({ workspaceId: ws, note: 'ok' }).success).toBe(false);
    expect(
      compSubscriptionSchema.safeParse({ workspaceId: ws, note: 'Launch partner', months: 37 })
        .success,
    ).toBe(false);
    expect(
      compSubscriptionSchema.safeParse({ workspaceId: ws, note: 'Launch partner', months: 0 })
        .success,
    ).toBe(false);
    expect(cancelOperatorSubscriptionSchema.parse({ reason: 'Fraud review' }).immediate).toBe(
      false,
    );
    expect(cancelOperatorSubscriptionSchema.safeParse({ reason: 'no' }).success).toBe(false);
  });

  it('normalises money to two decimals', () => {
    expect(normaliseMarketMoney('9')).toBe('9.00');
    expect(normaliseMarketMoney('9.5')).toBe('9.50');
    expect(normaliseMarketMoney('009.05')).toBe('9.05');
    expect(normaliseMarketMoney('0.1')).toBe('0.10');
  });
});

describe('the add-on that sells an app', () => {
  it('has a slug that fits the plan catalogue (at most 32 characters, [a-z0-9_]) and never changes with the app name', () => {
    const slug = marketPackSlug('8a6f0c3e-3b8e-4d0e-8f43-0d0f3f3f3f3f');
    expect(slug).toBe('mkt_8a6f0c3e3b8e4d0e8f43');
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(slug).toMatch(/^[a-z0-9_]{1,32}$/);
    expect(slug).toMatch(MARKET_PACK_SLUG_RE);
    expect(marketCheckoutPath(slug)).toBe('/billing/checkout/mkt_8a6f0c3e3b8e4d0e8f43');
  });

  it('grants one feature key per app, valid as a plan feature key even for the longest slug', () => {
    expect(marketEntitlementKey('quote-panel')).toBe('mkt_quote_panel');
    const longest = `a${'b-'.repeat(23)}c`; // 48 characters
    expect(longest).toHaveLength(48);
    const key = marketEntitlementKey(longest);
    expect(key).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    // two different slugs never share a key
    expect(marketEntitlementKey('a-b')).not.toBe(marketEntitlementKey('a-c'));
  });
});

describe('entitlement merge: the add-on grants the app, nothing else does', () => {
  const plan = (over: Partial<PlanFacts> = {}): PlanFacts => ({
    platformOwned: false,
    planKnown: true,
    overrides: {},
    planFeatures: {},
    planLimits: {},
    ...over,
  });
  const key = marketEntitlementKey('quote-panel');
  const grant = { features: [key], limits: {} };

  it('a workspace holding the add-on may use the app; one without it may not', () => {
    expect(mergeFeature(plan(), key, [grant])).toBe(true);
    expect(mergeFeature(plan(), key, [])).toBe(false);
    // another app's add-on does not unlock this one
    expect(
      mergeFeature(plan(), key, [{ features: [marketEntitlementKey('other')], limits: {} }]),
    ).toBe(false);
  });

  it('a plan can never hold the key by accident, and an override wins over the add-on', () => {
    expect(mergeFeature(plan({ planFeatures: { [key]: false } }), key, [])).toBe(false);
    expect(mergeFeature(plan({ overrides: { features: { [key]: false } } }), key, [grant])).toBe(
      false,
    );
    expect(mergeFeature(plan({ overrides: { features: { [key]: true } } }), key, [])).toBe(true);
  });

  it('a workspace the platform owns is never limited', () => {
    expect(mergeFeature(plan({ platformOwned: true }), key, [])).toBe(true);
  });
});

describe('what a workspace may do about a paid app', () => {
  const none = { includedPlanFeature: null, includedMinPlan: null };
  const catalogue = ['free', 'starter', 'growth', 'scale'];

  it('included by a plan feature, or by a plan at or above the named one', () => {
    expect(
      includedBy({
        ...none,
        includedPlanFeature: 'analytics',
        planFeatureOn: true,
        orgPlanSlug: 'free',
        planLapsed: false,
        catalogue,
      }),
    ).toBe('plan_feature');
    expect(
      includedBy({
        ...none,
        includedPlanFeature: 'analytics',
        planFeatureOn: false,
        orgPlanSlug: 'free',
        planLapsed: false,
        catalogue,
      }),
    ).toBeNull();
    const minGrowth = {
      includedPlanFeature: null,
      planFeatureOn: false,
      includedMinPlan: 'growth',
      planLapsed: false,
      catalogue,
    };
    expect(includedBy({ ...minGrowth, orgPlanSlug: 'growth' })).toBe('min_plan');
    expect(includedBy({ ...minGrowth, orgPlanSlug: 'scale' })).toBe('min_plan');
    expect(includedBy({ ...minGrowth, orgPlanSlug: 'starter' })).toBeNull();
    // a plan the catalogue does not know, and a lapsed paid plan, include nothing
    expect(includedBy({ ...minGrowth, orgPlanSlug: 'legacy' })).toBeNull();
    expect(includedBy({ ...minGrowth, orgPlanSlug: 'scale', planLapsed: true })).toBeNull();
    expect(includedBy({ ...minGrowth, orgPlanSlug: null })).toBeNull();
    expect(includedBy({ ...minGrowth, includedMinPlan: 'gone', orgPlanSlug: 'scale' })).toBeNull();
  });

  it('access: free, included, entitled, subscription required, not for sale', () => {
    const f = {
      model: 'paid_monthly' as const,
      includedBy: null,
      entitled: false,
      purchasable: true,
      hasActiveSubscription: false,
    };
    expect(accessFor({ ...f, model: 'free' })).toBe('free');
    expect(accessFor({ ...f, includedBy: 'min_plan' })).toBe('included');
    expect(accessFor({ ...f, entitled: true })).toBe('entitled');
    expect(accessFor(f)).toBe('subscription_required');
    expect(accessFor({ ...f, purchasable: false })).toBe('not_for_sale');
    // the platform stopped selling to newcomers; a workspace that already pays may still renew
    expect(accessFor({ ...f, purchasable: false, hasActiveSubscription: true })).toBe(
      'subscription_required',
    );
    // included beats entitled (nothing to pay for), entitled beats not for sale
    expect(accessFor({ ...f, includedBy: 'plan_feature', entitled: true })).toBe('included');
    expect(accessFor({ ...f, purchasable: false, entitled: true })).toBe('entitled');
  });

  it('a trial is offered once, on sale, to a workspace with nothing yet', () => {
    const f = {
      model: 'paid_monthly' as const,
      trialDays: 14,
      purchasable: true,
      hasSubscriptionRow: false,
      access: 'subscription_required' as const,
    };
    expect(trialAvailable(f)).toBe(true);
    expect(trialAvailable({ ...f, trialDays: 0 })).toBe(false);
    expect(trialAvailable({ ...f, purchasable: false })).toBe(false);
    expect(trialAvailable({ ...f, hasSubscriptionRow: true })).toBe(false);
    expect(trialAvailable({ ...f, access: 'entitled' })).toBe(false);
    expect(trialAvailable({ ...f, access: 'included' })).toBe(false);
    expect(trialAvailable({ ...f, model: 'free' })).toBe(false);
  });
});

describe('lapse and cancel rules (what a subscription is to a person)', () => {
  const facts = (
    over: Partial<{
      status: 'active' | 'lapsed';
      source: 'purchase' | 'trial' | 'comp';
      cancelAtPeriodEnd: boolean;
      currentPeriodEnd: Date | null;
    }> = {},
  ) => ({
    status: 'active' as const,
    source: 'purchase' as const,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
    ...over,
  });

  it('is active, trialing or comped while the period runs', () => {
    expect(deriveSubscriptionStatus(facts(), NOW)).toBe('active');
    expect(deriveSubscriptionStatus(facts({ source: 'trial' }), NOW)).toBe('trialing');
    expect(deriveSubscriptionStatus(facts({ source: 'comp' }), NOW)).toBe('comped');
    expect(deriveSubscriptionStatus(facts({ source: 'comp', currentPeriodEnd: null }), NOW)).toBe(
      'comped',
    );
  });

  it('cancelling keeps it running until the period ends, then it is ended', () => {
    expect(deriveSubscriptionStatus(facts({ cancelAtPeriodEnd: true }), NOW)).toBe('canceling');
    expect(deriveSubscriptionStatus(facts({ cancelAtPeriodEnd: true, source: 'trial' }), NOW)).toBe(
      'canceling',
    );
    expect(
      deriveSubscriptionStatus(
        facts({ cancelAtPeriodEnd: true, currentPeriodEnd: new Date('2026-10-09T23:59:59Z') }),
        NOW,
      ),
    ).toBe('ended');
  });

  it('a period that has run out is ended even before the sweep recorded it; a lapsed row is ended whatever its date', () => {
    expect(
      deriveSubscriptionStatus(facts({ currentPeriodEnd: new Date('2026-10-10T00:00:00Z') }), NOW),
    ).toBe('ended');
    expect(
      deriveSubscriptionStatus(facts({ currentPeriodEnd: new Date('2026-10-09T00:00:00Z') }), NOW),
    ).toBe('ended');
    expect(deriveSubscriptionStatus(facts({ status: 'lapsed' }), NOW)).toBe('ended');
    expect(
      deriveSubscriptionStatus(
        facts({ status: 'lapsed', currentPeriodEnd: null, source: 'comp' }),
        NOW,
      ),
    ).toBe('ended');
  });

  it('cancel is for a live paid or trial subscription, never a comp; resume only undoes a cancellation', () => {
    expect(subscriptionActions('active', 'purchase', 20, true)).toEqual({
      canCancel: true,
      canResume: false,
      canRenew: false,
    });
    expect(subscriptionActions('trialing', 'trial', 5, true)).toMatchObject({
      canCancel: true,
      canResume: false,
    });
    expect(subscriptionActions('canceling', 'purchase', 20, true)).toEqual({
      canCancel: false,
      canResume: true,
      canRenew: false,
    });
    expect(subscriptionActions('comped', 'comp', null, true)).toEqual({
      canCancel: false,
      canResume: false,
      canRenew: false,
    });
    expect(subscriptionActions('ended', 'purchase', 0, true)).toEqual({
      canCancel: false,
      canResume: false,
      canRenew: true,
    });
  });

  it('renew is offered near the end of the period or after it, and only while the app is on sale', () => {
    expect(subscriptionActions('active', 'purchase', 7, true).canRenew).toBe(true);
    expect(subscriptionActions('active', 'purchase', 8, true).canRenew).toBe(false);
    expect(subscriptionActions('canceling', 'purchase', 3, true).canRenew).toBe(true);
    expect(subscriptionActions('active', 'purchase', 3, false).canRenew).toBe(false);
    expect(subscriptionActions('ended', 'trial', 0, false).canRenew).toBe(false);
    expect(subscriptionActions('active', 'comp', 1, true).canRenew).toBe(false);
  });

  it('a failed card renewal is past due while the paid period or its grace days run, then ended', () => {
    const failed = (over: Record<string, unknown> = {}) => ({
      ...facts(),
      paymentFailedAt: new Date('2026-10-09T00:00:00Z'),
      ...over,
    });
    // the period still runs: the app works, the payment needs fixing
    expect(deriveSubscriptionStatus(failed(), NOW)).toBe('past_due');
    // the period ran out two days ago but the grace days (to the 13th) keep it working
    expect(
      deriveSubscriptionStatus(
        failed({
          currentPeriodEnd: new Date('2026-10-08T00:00:00Z'),
          graceEndsAt: new Date('2026-10-13T00:00:00Z'),
        }),
        NOW,
      ),
    ).toBe('past_due');
    // grace over: ended, like any lapsed subscription
    expect(
      deriveSubscriptionStatus(
        failed({
          currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
          graceEndsAt: new Date('2026-10-08T00:00:00Z'),
        }),
        NOW,
      ),
    ).toBe('ended');
    // no grace configured: the end of the period is the end
    expect(
      deriveSubscriptionStatus(failed({ currentPeriodEnd: new Date('2026-10-08T00:00:00Z') }), NOW),
    ).toBe('ended');
    expect(deriveSubscriptionStatus(failed({ status: 'lapsed' }), NOW)).toBe('ended');
  });

  it('past due offers cancelling and paying now; a stopped card renewal cannot be taken back, so it offers paying again', () => {
    expect(subscriptionActions('past_due', 'purchase', 2, true)).toEqual({
      canCancel: true,
      canResume: false,
      canRenew: true,
    });
    // cancelled at the provider (autopayStopped): resume is impossible and paying again is open at any time before the end
    expect(
      subscriptionActions('canceling', 'purchase', 20, true, { autopayStopped: true }),
    ).toEqual({
      canCancel: false,
      canResume: false,
      canRenew: true,
    });
    // a cancellation that left the provider alone (a prepaid month) can still be taken back
    expect(
      subscriptionActions('canceling', 'purchase', 20, true, { autopayStopped: false }).canResume,
    ).toBe(true);
    // a card that renews it needs nothing renewed by hand (a second subscription would charge twice), even in the last days
    expect(
      subscriptionActions('active', 'purchase', 3, true, { autoRenewing: true }).canRenew,
    ).toBe(false);
    expect(
      subscriptionActions('active', 'purchase', 3, true, { autoRenewing: false }).canRenew,
    ).toBe(true);
    // still not offered when the app is no longer sold
    expect(
      subscriptionActions('canceling', 'purchase', 20, false, { autopayStopped: true }).canRenew,
    ).toBe(false);
  });

  it('days left rounds up and never goes negative', () => {
    expect(daysUntil(new Date('2026-10-10T00:00:01Z'), NOW)).toBe(1);
    expect(daysUntil(new Date('2026-10-11T00:00:00Z'), NOW)).toBe(1);
    expect(daysUntil(new Date('2026-10-09T00:00:00Z'), NOW)).toBe(0);
  });

  it('paying ahead is bounded so a stray click cannot buy a year', () => {
    expect(mayPayAhead(MARKET_RENEW_AHEAD_DAYS)).toBe(true);
    expect(mayPayAhead(MARKET_RENEW_AHEAD_DAYS + 1)).toBe(false);
    expect(mayPayAhead(null)).toBe(false);
  });
});

describe('what checkout may sell (the same rules as the page, on a direct request)', () => {
  const ok = {
    visible: true,
    appStatus: 'published',
    pricingModel: 'paid_monthly' as const,
    purchasable: true,
    subscriptionActive: false,
    included: false,
    remainingDays: null,
  };

  it('sells a published paid app, and a hidden one the workspace already has', () => {
    expect(packPurchaseVerdict(ok)).toBe('ok');
    expect(packPurchaseVerdict({ ...ok, appStatus: 'hidden' })).toBe('ok');
  });

  it('refuses an app the workspace cannot see, a draft, a killed or a free app', () => {
    expect(packPurchaseVerdict({ ...ok, visible: false })).toBe('unavailable');
    expect(packPurchaseVerdict({ ...ok, appStatus: 'killed' })).toBe('unavailable');
    expect(packPurchaseVerdict({ ...ok, appStatus: 'draft' })).toBe('unavailable');
    expect(packPurchaseVerdict({ ...ok, pricingModel: 'free' })).toBe('unavailable');
    expect(packPurchaseVerdict({ ...ok, pricingModel: null })).toBe('unavailable');
  });

  it('refuses what the plan includes, and what has stopped selling to newcomers', () => {
    expect(packPurchaseVerdict({ ...ok, included: true })).toBe('included');
    expect(packPurchaseVerdict({ ...ok, purchasable: false })).toBe('not_for_sale');
    expect(packPurchaseVerdict({ ...ok, purchasable: false, subscriptionActive: true })).toBe('ok');
  });

  it('refuses paying more than about two months ahead', () => {
    expect(packPurchaseVerdict({ ...ok, remainingDays: 30 })).toBe('ok');
    expect(packPurchaseVerdict({ ...ok, remainingDays: 45 })).toBe('ok');
    expect(packPurchaseVerdict({ ...ok, remainingDays: 46 })).toBe('paid_ahead');
  });
});

describe('a renewal extends the term already paid for', () => {
  const now = new Date('2026-10-10T00:00:00Z');

  it('counts from the current end for an app, from now otherwise', () => {
    const end = new Date('2026-10-25T00:00:00Z');
    expect(termBase(now, true, end)).toEqual(end);
    expect(termBase(now, true, new Date('2026-10-01T00:00:00Z'))).toEqual(now);
    expect(termBase(now, true, null)).toEqual(now);
    // an ordinary add-on is a stackable boost: every purchase is a term of its own
    expect(termBase(now, false, end)).toEqual(now);
  });
});

describe('the views', () => {
  it('shows the operator the pricing, and the add-on slug once the app has been priced', () => {
    const app = '8a6f0c3e-3b8e-4d0e-8f43-0d0f3f3f3f3f';
    expect(
      toPricingView(
        { ...paid, pricingModel: 'free', priceAmount: null, priceCurrency: null, trialDays: 0 },
        app,
        false,
      ),
    ).toMatchObject({ model: 'free', packSlug: null, purchasable: true });
    expect(toPricingView(paid, app, true)).toMatchObject({
      model: 'paid_monthly',
      amount: '9.00',
      currency: 'USD',
      trialDays: 14,
      packSlug: 'mkt_8a6f0c3e3b8e4d0e8f43',
    });
    // free again after being paid: the pack exists and stays visible to the operator
    expect(toPricingView({ ...paid, pricingModel: 'free' }, app, true).packSlug).toBe(
      'mkt_8a6f0c3e3b8e4d0e8f43',
    );
  });

  it('tells a workspace what the next payment will be when the price moved, not before', () => {
    expect(toSubscriptionView(sub(), paid, 'published', NOW)).toMatchObject({
      status: 'active',
      amount: '9.00',
      nextAmount: null,
    });
    const moved = { ...paid, priceAmount: '12.00' };
    expect(toSubscriptionView(sub(), moved, 'published', NOW)).toMatchObject({
      amount: '9.00',
      nextAmount: '12.00',
      nextCurrency: 'USD',
    });
    expect(
      toSubscriptionView(sub(), { ...paid, priceCurrency: 'INR' }, 'published', NOW),
    ).toMatchObject({ nextAmount: '9.00', nextCurrency: 'INR' });
    // a trial or a comp paid nothing, so there is no "price change" to announce
    expect(
      toSubscriptionView(
        sub({ source: 'trial', amount: null, currency: null }),
        moved,
        'published',
        NOW,
      ).nextAmount,
    ).toBeNull();
  });

  it('says the card renews it only while a provider subscription is live and nobody asked to stop it', () => {
    const live = sub({ autorenew: true });
    expect(
      toSubscriptionView(live, { ...paid, billingMode: 'recurring' }, 'published', NOW),
    ).toMatchObject({
      autoRenew: true,
      status: 'active',
    });
    expect(toSubscriptionView(sub(), paid, 'published', NOW).autoRenew).toBe(false);
    // cancelled (the flag) or lapsed: it does not renew any more
    expect(
      toSubscriptionView(sub({ autorenew: true, cancelAtPeriodEnd: true }), paid, 'published', NOW)
        .autoRenew,
    ).toBe(false);
    expect(
      toSubscriptionView(sub({ autorenew: true, status: 'lapsed' }), paid, 'published', NOW)
        .autoRenew,
    ).toBe(false);
  });

  it('a yearly payment is shown per year, and the next payment compares with the yearly price', () => {
    const yearly = sub({ billingPeriod: 'yearly', amount: '90.00' });
    const pricing = { ...paid, annualAmount: '90.00' };
    expect(toSubscriptionView(yearly, pricing, 'published', NOW)).toMatchObject({
      period: 'yearly',
      amount: '90.00',
      nextAmount: null,
    });
    // the monthly price moved but the yearly one did not: nothing to announce to a yearly subscriber
    expect(
      toSubscriptionView(yearly, { ...pricing, priceAmount: '12.00' }, 'published', NOW).nextAmount,
    ).toBeNull();
    expect(
      toSubscriptionView(yearly, { ...pricing, annualAmount: '108.00' }, 'published', NOW),
    ).toMatchObject({ nextAmount: '108.00', nextCurrency: 'USD' });
  });

  it('a locked subscriber pays what they paid: no price change to announce, and the view says so', () => {
    const locked = sub({ priceLocked: true });
    const view = toSubscriptionView(
      locked,
      { ...paid, priceAmount: '12.00', priceLock: true },
      'published',
      NOW,
    );
    expect(view).toMatchObject({ priceLocked: true, amount: '9.00', nextAmount: null });
    // not locked: the same price rise is announced
    expect(
      toSubscriptionView(sub(), { ...paid, priceAmount: '12.00' }, 'published', NOW).nextAmount,
    ).toBe('12.00');
  });

  it('shows a failed renewal with the date the grace ends, and pay-again after the provider stopped', () => {
    const failed = toSubscriptionView(
      sub({
        autorenew: true,
        currentPeriodEnd: new Date('2026-10-09T00:00:00Z'),
        paymentFailedAt: new Date('2026-10-09T01:00:00Z'),
        graceEndsAt: new Date('2026-10-16T00:00:00Z'),
      }),
      { ...paid, billingMode: 'recurring' },
      'published',
      NOW,
    );
    expect(failed).toMatchObject({
      status: 'past_due',
      paymentFailedAt: '2026-10-09T01:00:00.000Z',
      graceEndsAt: '2026-10-16T00:00:00.000Z',
      actions: { canCancel: true, canRenew: true },
    });
    const stopped = toSubscriptionView(
      sub({
        cancelAtPeriodEnd: true,
        autorenewStoppedAt: new Date('2026-10-05T00:00:00Z'),
      }),
      paid,
      'published',
      NOW,
    );
    expect(stopped.status).toBe('canceling');
    expect(stopped.actions).toEqual({ canCancel: false, canResume: false, canRenew: true });
  });

  it('on sale means paid, reachable, and open to newcomers or already subscribed', () => {
    expect(onSale(paid, 'published', null)).toBe(true);
    expect(onSale(paid, 'hidden', null)).toBe(true);
    expect(onSale(paid, 'killed', null)).toBe(false);
    expect(onSale({ ...paid, purchasable: false }, 'published', null)).toBe(false);
    expect(onSale({ ...paid, purchasable: false }, 'published', { status: 'active' })).toBe(true);
    expect(onSale({ ...paid, pricingModel: 'free' }, 'published', null)).toBe(false);
  });
});

describe('a first-party app that owns existing plan features', () => {
  const base = { rowVersion: 1, model: 'paid_monthly' as const, amount: '9', currency: 'USD' };

  it('may only own a feature whose registry default is off (the default would otherwise give everyone what the app sells)', () => {
    expect(coreFeatureDefault('analytics')).toBe(false);
    expect(planFeatureOwnableByApp('analytics')).toBe(true);
    expect(planFeatureOwnableByApp('chatbot_widgets')).toBe(true);
    // appointment booking is ON by default today: it can become an app only after its default is switched off
    expect(coreFeatureDefault('sales_pipeline')).toBe(true);
    expect(planFeatureOwnableByApp('sales_pipeline')).toBe(false);
    // booking was ON by default until it became the first paid app; its default is off now, so the app can own it
    expect(coreFeatureDefault('appointment_booking')).toBe(false);
    expect(planFeatureOwnableByApp('appointment_booking')).toBe(true);
    // a module-contributed key has no registry default: it is off unless a plan or an add-on says so
    expect(coreFeatureDefault('some_module_feature')).toBeNull();
    expect(planFeatureOwnableByApp('some_module_feature')).toBe(true);
    // every core feature is one or the other, so the rule is total
    for (const d of PLAN_FEATURE_DEFS) expect(planFeatureOwnableByApp(d.key)).toBe(!d.default);
  });

  it('declares the keys it grants, once each, and only when paid', () => {
    const ok = setMarketPricingSchema.parse({
      ...base,
      grantsPlanFeatures: ['analytics'],
      grandfatherExisting: true,
    });
    expect(ok).toMatchObject({ grantsPlanFeatures: ['analytics'], grandfatherExisting: true });
    expect(setMarketPricingSchema.parse(base)).toMatchObject({
      grantsPlanFeatures: [],
      grandfatherExisting: false,
    });
    expect(
      setMarketPricingSchema.safeParse({ ...base, grantsPlanFeatures: ['analytics', 'analytics'] })
        .success,
    ).toBe(false);
    expect(
      setMarketPricingSchema.safeParse({ ...base, grantsPlanFeatures: ['Not A Key'] }).success,
    ).toBe(false);
    expect(
      setMarketPricingSchema.safeParse({
        rowVersion: 1,
        model: 'free',
        grantsPlanFeatures: ['analytics'],
      }).success,
    ).toBe(false);
    expect(
      setMarketPricingSchema.safeParse({ rowVersion: 1, model: 'free', grandfatherExisting: true })
        .success,
    ).toBe(false);
  });

  it('comping existing users needs the features to look for, and a granted feature cannot include the app', () => {
    expect(setMarketPricingSchema.safeParse({ ...base, grandfatherExisting: true }).success).toBe(
      false,
    );
    expect(
      pricingIssues({
        model: 'paid_monthly',
        amount: '9',
        currency: 'USD',
        grandfatherExisting: true,
      }).map((i) => i.path),
    ).toEqual(['grandfatherExisting']);
    expect(
      pricingIssues({
        model: 'paid_monthly',
        amount: '9',
        currency: 'USD',
        grantsPlanFeatures: ['analytics'],
        includedPlanFeature: 'analytics',
      }).map((i) => i.path),
    ).toEqual(['includedPlanFeature']);
  });

  it('the plan feature a subscription grants merges through the same entitlement code as any plan flag', () => {
    const plan: PlanFacts = {
      platformOwned: false,
      planKnown: true,
      overrides: {},
      planFeatures: { analytics: false },
      planLimits: {},
    };
    // the plans domain's resolver merges the grant into planFeatures, so the flag reads true; the workspace's own override still wins
    expect(
      mergeFeature(
        { ...plan, planFeatures: { ...plan.planFeatures, analytics: true } },
        'analytics',
        [],
      ),
    ).toBe(true);
    expect(
      mergeFeature(
        {
          ...plan,
          planFeatures: { analytics: true },
          overrides: { features: { analytics: false } },
        },
        'analytics',
        [],
      ),
    ).toBe(false);
    // and an add-on that grants a core key counts through the add-on merge too (the Marketplace's own access check)
    expect(
      mergeFeature(plan, 'analytics', [
        { features: ['analytics', marketEntitlementKey('booking-lite')], limits: {} },
      ]),
    ).toBe(true);
  });
});
