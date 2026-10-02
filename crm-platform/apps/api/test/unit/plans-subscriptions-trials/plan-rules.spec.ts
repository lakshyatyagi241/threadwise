import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PLAN_CHIP_ORDER, planCardSchema, planSlugSchema } from '@crm/contracts';
import {
  FALLBACK_PLAN_SLUG,
  buildPlanCard,
  byCatalogueOrder,
  classifyPlanAction,
  pickChips,
  pickDefaultPlan,
  planKind,
  slugifyPlanName,
  trialFor,
  uniquePlanSlug,
  type PlanFacts,
} from '../../../src/modules/plans-subscriptions-trials/plan-rules';

/** A paid plan by default; each test overrides what it is about. */
function plan(over: Partial<PlanFacts> & { slug: string }): PlanFacts {
  return {
    id: randomUUID(),
    name: over.slug,
    subtitle: null,
    amount: '10.00',
    offerAmount: null,
    currency: 'USD',
    billingUnit: 'months',
    billingDuration: 1,
    isFree: false,
    isLifetime: false,
    isActive: true,
    isDefault: false,
    isHighlighted: false,
    isCustomQuote: false,
    sortOrder: 0,
    ctaLabel: 'Get started',
    limits: {},
    features: {},
    ...over,
  };
}
const free = (slug: string, over: Partial<PlanFacts> = {}) =>
  plan({ slug, isFree: true, amount: '0.00', ...over });
const paid = (slug: string, amount: string, over: Partial<PlanFacts> = {}) =>
  plan({ slug, amount, ...over });
const quote = (slug: string, over: Partial<PlanFacts> = {}) =>
  plan({ slug, isCustomQuote: true, amount: '0.00', ...over });

describe('planKind', () => {
  it('is free when flagged free or priced at 0, paid when priced', () => {
    expect(planKind({ isFree: true, isCustomQuote: false, amount: '0.00' })).toBe('free');
    expect(planKind({ isFree: false, isCustomQuote: false, amount: '0.00' })).toBe('free');
    expect(planKind({ isFree: false, isCustomQuote: false, amount: '0' })).toBe('free');
    expect(planKind({ isFree: false, isCustomQuote: false, amount: '0.01' })).toBe('paid');
    expect(planKind({ isFree: false, isCustomQuote: false, amount: '1499.00' })).toBe('paid');
  });

  it('checks the custom quote first: it carries no price and must never read as free', () => {
    expect(planKind({ isFree: false, isCustomQuote: true, amount: '0.00' })).toBe('custom_quote');
    expect(planKind({ isFree: true, isCustomQuote: true, amount: '0.00' })).toBe('custom_quote');
    expect(planKind({ isFree: false, isCustomQuote: true, amount: '99.00' })).toBe('custom_quote');
  });

  it('trusts the free flag over a stray price', () => {
    expect(planKind({ isFree: true, isCustomQuote: false, amount: '5.00' })).toBe('free');
  });
});

describe('catalogue order', () => {
  it('sorts by sort order, then cheapest first, then slug', () => {
    const rows = [
      paid('c', '30.00', { sortOrder: 1 }),
      paid('b', '20.00', { sortOrder: 1 }),
      paid('z_tie', '20.00', { sortOrder: 1 }),
      paid('a_tie', '20.00', { sortOrder: 1 }),
      paid('first', '99.00', { sortOrder: 0 }),
    ];
    expect([...rows].sort(byCatalogueOrder).map((p) => p.slug)).toEqual([
      'first',
      'a_tie',
      'b',
      'z_tie',
      'c',
    ]);
  });

  it('compares prices as numbers, not as strings', () => {
    const rows = [paid('nine', '9.00'), paid('hundred', '100.00'), paid('ten', '10.00')];
    expect(rows.sort(byCatalogueOrder).map((p) => p.slug)).toEqual(['nine', 'ten', 'hundred']);
  });
});

describe('pickDefaultPlan (the 4-step sign-up resolution)', () => {
  it('step 1: the registration setting wins over a flagged default and a free plan', () => {
    const plans = [
      free('free'),
      paid('pro', '29.00'),
      paid('flagged', '15.00', { isDefault: true }),
    ];
    const got = pickDefaultPlan(plans, 'pro');
    expect(got.slug).toBe('pro');
    expect(got.plan?.slug).toBe('pro');
    expect(got.step).toBe('setting');
  });

  it('step 1 matches the setting ignoring case and surrounding spaces', () => {
    expect(pickDefaultPlan([paid('pro', '29.00')], '  PRO ').slug).toBe('pro');
  });

  it('step 1 accepts a paid plan as the registration default', () => {
    const got = pickDefaultPlan([free('free'), paid('pro', '29.00')], 'pro');
    expect(got).toMatchObject({ slug: 'pro', step: 'setting' });
  });

  it('an INACTIVE plan named by the setting falls through to the flagged default', () => {
    const plans = [
      paid('pro', '29.00', { isActive: false }),
      free('free'),
      paid('flagged', '15.00', { isDefault: true }),
    ];
    expect(pickDefaultPlan(plans, 'pro')).toMatchObject({ slug: 'flagged', step: 'flagged' });
  });

  it('a setting that names no existing plan falls through', () => {
    const plans = [free('free')];
    expect(pickDefaultPlan(plans, 'ghost')).toMatchObject({ slug: 'free', step: 'free' });
  });

  it('a null, undefined or blank setting is the same as none', () => {
    const plans = [free('free'), paid('flagged', '15.00', { isDefault: true })];
    for (const setting of [null, undefined, '', '   ']) {
      expect(pickDefaultPlan(plans, setting)).toMatchObject({ slug: 'flagged', step: 'flagged' });
    }
  });

  it('step 2: the first ACTIVE flagged default, even when it is paid and a free plan exists', () => {
    const plans = [free('free'), paid('flagged', '15.00', { isDefault: true })];
    expect(pickDefaultPlan(plans, null)).toMatchObject({ slug: 'flagged', step: 'flagged' });
  });

  it('step 2 ignores a flagged default that is inactive', () => {
    const plans = [paid('flagged', '15.00', { isDefault: true, isActive: false }), free('free')];
    expect(pickDefaultPlan(plans, null)).toMatchObject({ slug: 'free', step: 'free' });
  });

  it('step 2 takes the first flagged default in catalogue order if data ever holds two', () => {
    const plans = [
      paid('later', '5.00', { isDefault: true, sortOrder: 2 }),
      paid('sooner', '50.00', { isDefault: true, sortOrder: 1 }),
    ];
    expect(pickDefaultPlan(plans, null).slug).toBe('sooner');
  });

  it('step 3: the first active free plan by sort order, not by position or price', () => {
    const plans = [
      paid('pro', '29.00', { sortOrder: 0 }),
      free('free_late', { sortOrder: 5 }),
      free('free_early', { sortOrder: 2 }),
    ];
    expect(pickDefaultPlan(plans, null)).toMatchObject({ slug: 'free_early', step: 'free' });
  });

  it('step 3 breaks a sort-order tie by price, then slug', () => {
    // Both are free (price 0): the slug decides, so the answer is stable.
    const plans = [free('b_free'), free('a_free')];
    expect(pickDefaultPlan(plans, null).slug).toBe('a_free');
  });

  it('step 3 counts a plan priced at 0 as free even without the flag', () => {
    const plans = [plan({ slug: 'zero', amount: '0.00', isFree: false })];
    expect(pickDefaultPlan(plans, null)).toMatchObject({ slug: 'zero', step: 'free' });
  });

  it('step 3 skips inactive free plans and custom quotes', () => {
    const plans = [free('off', { isActive: false }), quote('enterprise'), paid('pro', '29.00')];
    expect(pickDefaultPlan(plans, null)).toMatchObject({
      slug: FALLBACK_PLAN_SLUG,
      step: 'literal',
    });
  });

  it('step 4: the literal slug starter, even when there is no such plan', () => {
    const none = pickDefaultPlan([], null);
    expect(none).toEqual({ slug: 'starter', plan: null, step: 'literal' });
    const onlyPaid = pickDefaultPlan([paid('pro', '29.00')], null);
    expect(onlyPaid).toEqual({ slug: 'starter', plan: null, step: 'literal' });
  });

  it('step 4 does not adopt an inactive plan that happens to be called starter', () => {
    const got = pickDefaultPlan([free('starter', { isActive: false })], null);
    expect(got.slug).toBe('starter');
    expect(got.plan).toBeNull();
    expect(got.step).toBe('literal');
  });

  it('does not mutate the list it is given', () => {
    const plans = [paid('z', '9.00', { sortOrder: 2 }), free('a', { sortOrder: 1 })];
    const snapshot = plans.map((p) => p.slug);
    pickDefaultPlan(plans, null);
    expect(plans.map((p) => p.slug)).toEqual(snapshot);
  });
});

describe('trialFor (the trial rule)', () => {
  const now = new Date('2026-10-01T10:00:00.000Z');
  const DAY = 86_400_000;

  it('free plan with 14 days: trial ends in 14 days and the cycle is trial', () => {
    const got = trialFor(free('free'), 14, now);
    expect(got.billingCycle).toBe('trial');
    expect(got.trialEndsAt).toEqual(new Date(now.getTime() + 14 * DAY));
    expect(got.trialEndsAt?.toISOString()).toBe('2026-10-15T10:00:00.000Z');
  });

  it('free plan with 0 days: no trial, monthly', () => {
    expect(trialFor(free('free'), 0, now)).toEqual({ trialEndsAt: null, billingCycle: 'monthly' });
  });

  it('paid plan with 14 days: no trial, monthly', () => {
    expect(trialFor(paid('pro', '29.00'), 14, now)).toEqual({
      trialEndsAt: null,
      billingCycle: 'monthly',
    });
  });

  it('no plan row (the literal fallback): no trial even with days set', () => {
    expect(trialFor(null, 14, now)).toEqual({ trialEndsAt: null, billingCycle: 'monthly' });
  });

  it('a custom quote is not free: no trial', () => {
    expect(trialFor(quote('enterprise'), 14, now)).toEqual({
      trialEndsAt: null,
      billingCycle: 'monthly',
    });
  });

  it('a plan priced at 0 without the free flag still earns the trial', () => {
    const got = trialFor({ isFree: false, isCustomQuote: false, amount: '0.00' }, 7, now);
    expect(got.billingCycle).toBe('trial');
    expect(got.trialEndsAt).toEqual(new Date(now.getTime() + 7 * DAY));
  });

  it('a negative or zero length never starts a trial', () => {
    expect(trialFor(free('free'), -3, now).trialEndsAt).toBeNull();
    expect(trialFor(free('free'), 0, now).trialEndsAt).toBeNull();
  });

  it('the longest allowed trial (365 days) is a whole number of days from now', () => {
    expect(trialFor(free('free'), 365, now).trialEndsAt).toEqual(
      new Date(now.getTime() + 365 * DAY),
    );
  });

  it('does not change the clock value it was given', () => {
    const before = now.getTime();
    trialFor(free('free'), 14, now);
    expect(now.getTime()).toBe(before);
  });
});

describe('classifyPlanAction (upgrade / downgrade matrix)', () => {
  const FREE = free('free');
  const FREE2 = free('free_two');
  const BASIC = paid('basic', '10.00');
  const PRO = paid('pro', '30.00');
  const PRO_TWIN = paid('pro_twin', '30.00');
  const ENT = quote('enterprise');
  const act = (cur: PlanFacts | null, target: PlanFacts, slug: string | null = cur?.slug ?? null) =>
    classifyPlanAction(cur, slug, target);

  it('the plan itself is current, whatever its kind', () => {
    for (const p of [FREE, BASIC, ENT]) expect(act(p, p)).toBe('current');
  });

  it('a custom quote target is contact sales from every starting point', () => {
    expect(act(FREE, ENT)).toBe('contact_sales');
    expect(act(BASIC, ENT)).toBe('contact_sales');
    expect(act(null, ENT, null)).toBe('contact_sales');
  });

  it('a free target is continue free (it changes nothing), also from a paid plan', () => {
    expect(act(FREE, FREE2)).toBe('continue_free');
    expect(act(BASIC, FREE)).toBe('continue_free');
    expect(act(ENT, FREE)).toBe('continue_free');
    expect(act(null, FREE, null)).toBe('continue_free');
  });

  it('no known current plan: every paid plan is choose', () => {
    expect(act(null, BASIC, null)).toBe('choose');
    expect(act(null, PRO, 'starter')).toBe('choose');
    expect(act(null, PRO, 'deleted_plan')).toBe('choose');
  });

  it('current free: every paid plan is an upgrade', () => {
    expect(act(FREE, BASIC)).toBe('upgrade');
    expect(act(FREE, PRO)).toBe('upgrade');
  });

  it('current custom quote counts as the top tier: paid targets are downgrade unavailable', () => {
    expect(act(ENT, BASIC)).toBe('downgrade_unavailable');
    expect(act(ENT, PRO)).toBe('downgrade_unavailable');
  });

  it('paid vs paid is ranked by list price', () => {
    expect(act(BASIC, PRO)).toBe('upgrade');
    expect(act(PRO, BASIC)).toBe('downgrade_unavailable');
    expect(act(PRO, PRO_TWIN)).toBe('choose');
  });

  it('compares list prices numerically (9.00 is below 100.00)', () => {
    expect(act(paid('nine', '9.00'), paid('hundred', '100.00'))).toBe('upgrade');
    expect(act(paid('hundred', '100.00'), paid('nine', '9.00'))).toBe('downgrade_unavailable');
  });
});

describe('pickChips', () => {
  const all = {
    analytics: true,
    automation: true,
    ai_assistants: true,
    woocommerce: true,
    shopify: true,
    calling: true,
    remove_branding: true,
  };

  it('returns at most three, in the fixed order analytics, automation, ai_assistants, ...', () => {
    expect(pickChips(all)).toEqual(['analytics', 'automation', 'ai_assistants']);
  });

  it('skips disabled features and keeps the order of the registry, not of the object', () => {
    const reversed = Object.fromEntries(
      [...PLAN_CHIP_ORDER].reverse().map((k) => [k, k !== 'analytics' && k !== 'ai_assistants']),
    );
    expect(pickChips(reversed)).toEqual(['automation', 'woocommerce', 'shopify']);
  });

  it('reaches the late keys when the early ones are off', () => {
    expect(
      pickChips({
        analytics: false,
        automation: false,
        ai_assistants: false,
        woocommerce: false,
        shopify: true,
        calling: true,
        remove_branding: true,
      }),
    ).toEqual(['shopify', 'calling', 'remove_branding']);
  });

  it('returns fewer than three when fewer are enabled, and none when nothing is', () => {
    const none = Object.fromEntries(PLAN_CHIP_ORDER.map((k) => [k, false]));
    expect(pickChips(none)).toEqual([]);
    expect(pickChips({ ...none, calling: true })).toEqual(['calling']);
  });

  it('a plan row that predates the keys takes the registry defaults', () => {
    // defaults: ai_assistants, woocommerce, shopify on; the rest off.
    expect(pickChips({})).toEqual(['ai_assistants', 'woocommerce', 'shopify']);
    expect(pickChips(null)).toEqual(['ai_assistants', 'woocommerce', 'shopify']);
    expect(pickChips(undefined)).toEqual(['ai_assistants', 'woocommerce', 'shopify']);
  });

  it('a stored non-boolean falls back to the registry default', () => {
    const got = pickChips({ analytics: 'yes', automation: 1, ai_assistants: false });
    // sales_pipeline is last in the chip order and on by default, so it fills a free slot.
    expect(got).toEqual(['woocommerce', 'shopify', 'sales_pipeline']);
  });

  it('honours an explicit max, including 0', () => {
    expect(pickChips(all, 1)).toEqual(['analytics']);
    expect(pickChips(all, 5)).toEqual([
      'analytics',
      'automation',
      'ai_assistants',
      'woocommerce',
      'shopify',
    ]);
    expect(pickChips(all, 0)).toEqual([]);
  });
});

describe('buildPlanCard', () => {
  it('builds a paid monthly card with its offer, period and chips', () => {
    const p = paid('pro', '29.00', {
      name: 'Pro',
      subtitle: 'For teams',
      offerAmount: '19.00',
      billingUnit: 'months',
      billingDuration: 1,
      isHighlighted: true,
      ctaLabel: 'Go Pro',
      limits: { monthly_messages: 5000 },
      features: { analytics: true, automation: true, ai_assistants: true, calling: true },
    });
    const card = buildPlanCard(p, null, null);
    expect(card).toEqual({
      id: p.id,
      slug: 'pro',
      name: 'Pro',
      subtitle: 'For teams',
      kind: 'paid',
      price: {
        amount: '29.00',
        offerAmount: '19.00',
        currency: 'USD',
        period: { unit: 'months', count: 1 },
      },
      lifetime: false,
      monthlyMessages: 5000,
      chips: ['analytics', 'automation', 'ai_assistants'],
      highlighted: true,
      current: false,
      action: 'choose',
      ctaLabel: 'Go Pro',
    });
    expect(planCardSchema.safeParse(card).success).toBe(true);
  });

  it('keeps the billing period as stored (3 years, 6 weeks...)', () => {
    const card = buildPlanCard(
      paid('long', '99.00', { billingUnit: 'years', billingDuration: 3 }),
      null,
      null,
    );
    expect(card.price.period).toEqual({ unit: 'years', count: 3 });
  });

  it('shows an offer only when the plan is paid', () => {
    const freeWithOffer = buildPlanCard(free('free', { offerAmount: '3.00' }), null, null);
    expect(freeWithOffer.price.offerAmount).toBeNull();
    const quoteWithOffer = buildPlanCard(quote('big', { offerAmount: '3.00' }), null, null);
    expect(quoteWithOffer.price.offerAmount).toBeNull();
  });

  it('drops an offer that is not below the list price or is zero', () => {
    expect(
      buildPlanCard(paid('a', '10.00', { offerAmount: '10.00' }), null, null).price.offerAmount,
    ).toBeNull();
    expect(
      buildPlanCard(paid('b', '10.00', { offerAmount: '12.00' }), null, null).price.offerAmount,
    ).toBeNull();
    expect(
      buildPlanCard(paid('c', '10.00', { offerAmount: '0.00' }), null, null).price.offerAmount,
    ).toBeNull();
    expect(
      buildPlanCard(paid('d', '10.00', { offerAmount: '9.99' }), null, null).price.offerAmount,
    ).toBe('9.99');
  });

  it('a lifetime plan has no period and is flagged lifetime (its price and offer stay)', () => {
    const card = buildPlanCard(
      paid('forever', '299.00', { isLifetime: true, offerAmount: '199.00' }),
      null,
      null,
    );
    expect(card.lifetime).toBe(true);
    expect(card.price.period).toBeNull();
    expect(card.price.amount).toBe('299.00');
    expect(card.price.offerAmount).toBe('199.00');
    expect(card.kind).toBe('paid');
  });

  it('a free plan has price 0.00 and no period, even with a stray price or lifetime flag', () => {
    const card = buildPlanCard(
      free('free', { amount: '5.00', isLifetime: true, billingUnit: 'years' }),
      null,
      null,
    );
    expect(card.kind).toBe('free');
    expect(card.price).toEqual({
      amount: '0.00',
      offerAmount: null,
      currency: 'USD',
      period: null,
    });
    expect(card.lifetime).toBe(false);
    expect(card.action).toBe('continue_free');
  });

  it('a custom quote shows no price and no period and means contact sales', () => {
    const card = buildPlanCard(
      quote('enterprise', { amount: '99.00', isLifetime: true }),
      null,
      null,
    );
    expect(card.kind).toBe('custom_quote');
    expect(card.price).toEqual({
      amount: '0.00',
      offerAmount: null,
      currency: 'USD',
      period: null,
    });
    expect(card.lifetime).toBe(false);
    expect(card.action).toBe('contact_sales');
  });

  it('marks the current plan and gives it the current action', () => {
    const free1 = free('free');
    const pro = paid('pro', '29.00');
    const cardFree = buildPlanCard(free1, 'free', free1);
    const cardPro = buildPlanCard(pro, 'free', free1);
    expect(cardFree).toMatchObject({ current: true, action: 'current' });
    expect(cardPro).toMatchObject({ current: false, action: 'upgrade' });
  });

  it('with no current slug nothing is current', () => {
    const card = buildPlanCard(paid('pro', '29.00'), null, null);
    expect(card.current).toBe(false);
  });

  it('a current slug with no plan row: nothing is current, paid plans are choose', () => {
    const card = buildPlanCard(paid('pro', '29.00'), 'starter', null);
    expect(card).toMatchObject({ current: false, action: 'choose' });
  });

  it('ranks by LIST price: an offer never changes the action', () => {
    const current = paid('mid', '50.00');
    const dearButOnOffer = paid('dear', '60.00', { offerAmount: '10.00' });
    const cheap = paid('cheap', '40.00');
    expect(buildPlanCard(dearButOnOffer, 'mid', current).action).toBe('upgrade');
    expect(buildPlanCard(cheap, 'mid', current).action).toBe('downgrade_unavailable');
  });

  it('a current custom quote makes every paid card downgrade unavailable', () => {
    const current = quote('enterprise');
    expect(buildPlanCard(paid('pro', '29.00'), 'enterprise', current).action).toBe(
      'downgrade_unavailable',
    );
  });

  it('monthly messages: the stored cap, 0 for unlimited, 0 for a missing or malformed value', () => {
    const card = (limits: unknown) => buildPlanCard(paid('p', '9.00', { limits }), null, null);
    expect(card({ monthly_messages: 1000 }).monthlyMessages).toBe(1000);
    expect(card({ monthly_messages: 0 }).monthlyMessages).toBe(0);
    expect(card({}).monthlyMessages).toBe(0);
    expect(card(null).monthlyMessages).toBe(0);
    expect(card({ monthly_messages: -5 }).monthlyMessages).toBe(0);
    expect(card({ monthly_messages: 2.5 }).monthlyMessages).toBe(0);
    expect(card({ monthly_messages: '1000' }).monthlyMessages).toBe(0);
  });

  it('keeps the stored currency, highlight flag and call to action', () => {
    const card = buildPlanCard(
      paid('eur', '20.00', { currency: 'EUR', isHighlighted: true, ctaLabel: 'Buy now' }),
      null,
      null,
    );
    expect(card).toMatchObject({ highlighted: true, ctaLabel: 'Buy now' });
    expect(card.price.currency).toBe('EUR');
  });
});

describe('slugifyPlanName', () => {
  it('derives lowercase letters, digits and underscores from a name', () => {
    expect(slugifyPlanName('Pro Plus')).toBe('pro_plus');
    expect(slugifyPlanName('Starter')).toBe('starter');
    expect(slugifyPlanName('Team 5')).toBe('team_5');
    expect(slugifyPlanName('2024 Plan')).toBe('2024_plan');
  });

  it('collapses runs of punctuation and trims the ends', () => {
    expect(slugifyPlanName('  Pro -- Plus!!  ')).toBe('pro_plus');
    expect(slugifyPlanName('__x__')).toBe('x');
    expect(slugifyPlanName('a   b\tc')).toBe('a_b_c');
    expect(slugifyPlanName('pro_plus')).toBe('pro_plus');
  });

  it('strips accents', () => {
    expect(slugifyPlanName('Café Plan')).toBe('cafe_plan');
    expect(slugifyPlanName('Über Plán')).toBe('uber_plan');
  });

  it('never yields a slug without a letter: a bare number, symbols or other scripts become plan', () => {
    expect(slugifyPlanName('2024')).toBe('plan');
    expect(slugifyPlanName('123 456')).toBe('plan');
    expect(slugifyPlanName('!!!')).toBe('plan');
    expect(slugifyPlanName('')).toBe('plan');
    expect(slugifyPlanName('   ')).toBe('plan');
    expect(slugifyPlanName('プロ')).toBe('plan');
  });

  it('cuts at 32 characters without leaving a trailing underscore', () => {
    const long = slugifyPlanName(`${'a'.repeat(31)} bcdefgh`);
    expect(long).toBe('a'.repeat(31));
    const exact = slugifyPlanName('x'.repeat(40));
    expect(exact).toHaveLength(32);
    expect(exact).toBe('x'.repeat(32));
  });

  it('falls back to plan when the first 32 characters carry no letter', () => {
    expect(slugifyPlanName(`${'1'.repeat(40)}abc`)).toBe('plan');
  });

  it('always produces a slug the plan contract accepts', () => {
    const inputs = [
      'Pro Plus',
      '2024',
      '',
      '!!!',
      'a'.repeat(100),
      `${'1'.repeat(33)}x`,
      'Ünïcödé Plán',
      '  spaced  out  ',
      '___',
      'MiXeD CaSe 7',
      'emoji 🚀 plan',
    ];
    for (const input of inputs) {
      const slug = slugifyPlanName(input);
      expect(planSlugSchema.safeParse(slug).success, `${JSON.stringify(input)} -> ${slug}`).toBe(
        true,
      );
      expect(slug.length).toBeLessThanOrEqual(32);
    }
  });
});

describe('uniquePlanSlug', () => {
  const taken = (...slugs: string[]) => new Set(slugs);

  it('returns the base when it is free', () => {
    expect(uniquePlanSlug('pro_plus', taken())).toBe('pro_plus');
    expect(uniquePlanSlug('pro_plus', taken('other'))).toBe('pro_plus');
  });

  it('appends _2, _3, ... until it is free', () => {
    expect(uniquePlanSlug('pro_plus', taken('pro_plus'))).toBe('pro_plus_2');
    expect(uniquePlanSlug('pro_plus', taken('pro_plus', 'pro_plus_2'))).toBe('pro_plus_3');
    expect(uniquePlanSlug('pro_plus', taken('pro_plus', 'pro_plus_2', 'pro_plus_3'))).toBe(
      'pro_plus_4',
    );
  });

  it('fills the first gap, not the next number after the highest', () => {
    expect(uniquePlanSlug('pro', taken('pro', 'pro_3'))).toBe('pro_2');
  });

  it('counts the suffix toward the 32-character limit', () => {
    const base = 'a'.repeat(32);
    const second = uniquePlanSlug(base, taken(base));
    expect(second).toBe(`${'a'.repeat(30)}_2`);
    expect(second).toHaveLength(32);
    const third = uniquePlanSlug(base, taken(base, second));
    expect(third).toBe(`${'a'.repeat(30)}_3`);
  });

  it('shrinks the base further when the suffix grows to two digits', () => {
    const base = 'a'.repeat(32);
    const all = new Set<string>([base]);
    for (let n = 2; n <= 9; n++) all.add(`${'a'.repeat(30)}_${n}`);
    const tenth = uniquePlanSlug(base, all);
    expect(tenth).toBe(`${'a'.repeat(29)}_10`);
    expect(tenth).toHaveLength(32);
  });

  it('does not leave a doubled underscore when the cut lands on one', () => {
    const base = `${'a'.repeat(29)}_bb`; // 32 chars; the cut for "_2" ends on the underscore
    expect(base).toHaveLength(32);
    expect(uniquePlanSlug(base, taken(base))).toBe(`${'a'.repeat(29)}_2`);
  });

  it('keeps a letter in the result even for a letterless base', () => {
    expect(uniquePlanSlug('1'.repeat(32), taken('1'.repeat(32)))).toBe('plan_2');
  });

  it('every candidate it returns is valid for the plan contract', () => {
    const base = 'b'.repeat(32);
    const all = new Set<string>([base]);
    for (let i = 0; i < 30; i++) {
      const next = uniquePlanSlug(base, all);
      expect(planSlugSchema.safeParse(next).success, next).toBe(true);
      expect(next.length).toBeLessThanOrEqual(32);
      expect(all.has(next)).toBe(false);
      all.add(next);
    }
    expect(all.size).toBe(31);
  });
});
