import { describe, expect, it } from 'vitest';
import { PLAN_FEATURE_KEYS, PLAN_LIMIT_KEYS, type PublicPlanCard } from '@crm/contracts';
import { toPricingCard, withPeriod, type CardWords } from './pricing-cards';

const words: CardWords = {
  planNum: (n) => `Plan · ${n}`,
  limit: (k) => `Label ${k}`,
  feature: (k) => `Feature ${k}`,
  unlimited: 'Unlimited',
  free: 'Free',
  custom: 'Custom',
  popular: 'popular',
  forever: 'forever',
  contactSales: 'contact sales',
  oneTime: 'one-time',
  talkToSales: 'Talk to sales',
  startFree: 'Start free',
  getStarted: 'Get started',
  docsCommunity: 'Docs & community',
  prioritySupport: 'Priority support',
  perUnit: (u, c) => `/ ${c} ${u}`,
  money: (a, c) => `${c} ${a}`,
  number: (n) => String(n),
};

const plan = (over: Partial<PublicPlanCard> = {}, flags: string[] = []): PublicPlanCard =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'growth',
    name: 'Growth',
    subtitle: 'For growing teams',
    kind: 'paid',
    price: {
      amount: '20.00',
      offerAmount: null,
      currency: 'USD',
      period: { unit: 'months', count: 1 },
    },
    lifetime: false,
    monthlyMessages: 1000,
    chips: [],
    highlighted: true,
    current: false,
    action: 'choose',
    ctaLabel: 'Get going',
    limits: Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, 0])),
    features: Object.fromEntries(PLAN_FEATURE_KEYS.map((k) => [k, flags.includes(k)])),
    yearlyAmount: '192.00',
    ctaUrl: '/register?plan=growth',
    ...over,
  }) as unknown as PublicPlanCard;

describe('toPricingCard (TW-CMS-003)', () => {
  it('numbers the card and shows the price and period the way Reference does', () => {
    const c = toPricingCard(plan(), 1, words);
    expect(c.num).toBe('Plan · 02');
    expect(c.name).toBe('Growth');
    expect(c.price).toBe('USD 20.00');
    expect(c.period).toBe('/ 1 months');
    expect(c.badge).toBe('popular');
    expect(c.ctaLabel).toBe('Get going →');
  });

  it('shows the yearly plan as the monthly equivalent of the yearly amount', () => {
    const c = toPricingCard(plan(), 0, words);
    expect(c.hasYearly).toBe(true);
    expect(c.priceYearly).toBe('USD 16.00');
  });

  it('keeps one price when the plan has no yearly amount, and for a lifetime plan', () => {
    expect(toPricingCard(plan({ yearlyAmount: null }), 0, words).hasYearly).toBe(false);
    expect(toPricingCard(plan({ lifetime: true }), 0, words).priceYearly).toBe('USD 20.00');
  });

  it('labels free and custom-quote plans', () => {
    const free = toPricingCard(plan({ kind: 'free', highlighted: false }), 0, words);
    expect([free.price, free.badge, free.period, free.ctaLabel]).toEqual([
      'Free',
      'free',
      '/ 1 months',
      'Start free →',
    ]);
    const custom = toPricingCard(plan({ kind: 'custom_quote', highlighted: false }), 0, words);
    expect([custom.price, custom.period]).toEqual(['Custom', 'contact sales']);
  });

  it('lists at most four volume lines, zero meaning unlimited', () => {
    const c = toPricingCard(plan(), 0, words);
    expect(c.volume).toHaveLength(4);
    expect(c.volume[0]!.label).toBe('Unlimited label devices');
  });

  it('lists enabled features first (at most seven) then a few greyed ones (at most three)', () => {
    const c = toPricingCard(plan({}, [...PLAN_FEATURE_KEYS]), 0, words);
    expect(c.features.filter((r) => r.included)).toHaveLength(7);
    expect(c.features.filter((r) => !r.included)).toHaveLength(0);
    const none = toPricingCard(plan(), 0, words);
    expect(none.features.filter((r) => !r.included)).toHaveLength(3);
  });

  it('adds priority support for a highlighted plan only', () => {
    expect(toPricingCard(plan(), 0, words).support).toHaveLength(2);
    expect(toPricingCard(plan({ highlighted: false }), 0, words).support).toHaveLength(1);
  });
});

describe('withPeriod', () => {
  it('adds the yearly period to checkout links of paid plans only', () => {
    expect(withPeriod('/checkout/x', 'paid', true)).toBe('/checkout/x?period=yearly');
    expect(withPeriod('/checkout/x?a=1', 'paid', true)).toBe('/checkout/x?a=1&period=yearly');
    expect(withPeriod('/register', 'free', true)).toBe('/register');
    expect(withPeriod('/checkout/x', 'paid', false)).toBe('/checkout/x');
    expect(withPeriod('#', 'paid', true)).toBe('#');
  });
});
