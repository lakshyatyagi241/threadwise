import { describe, expect, it } from 'vitest';
import {
  FREE_PRICING,
  MARKET_TRIAL_DAYS_MAX,
  PLAN_FEATURE_KEYS,
  PLAN_FEATURE_LABELS,
  pricingIssues,
  setMarketPricingSchema,
  type MarketPricingView,
  type PlanFeatureKey,
} from '@crm/contracts';
import {
  COMMON_CURRENCIES,
  MAX_GRANTED_FEATURES,
  PRICING_FIELDS,
  PRICING_PROBLEM_CODES,
  draftFromPricing,
  formatMoney,
  formatMrr,
  hasPricingProblems,
  isPricingDirty,
  ownableFeatureKeys,
  priceLabel,
  pricingConfirmation,
  pricingPayload,
  pricingProblems,
  pricingServerFields,
  type PricingDraft,
} from './pricing';

const PAID: MarketPricingView = {
  model: 'paid_monthly',
  amount: '9.00',
  currency: 'USD',
  annualAmount: '90.00',
  trialDays: 14,
  purchasable: true,
  includedPlanFeature: 'analytics',
  includedMinPlan: 'scale',
  priceChangedAt: '2026-10-01T00:00:00.000Z',
  grantsPlanFeatures: ['calling'],
  grandfatherExisting: true,
  packSlug: 'mkt_0123456789abcdef0123',
};

const paidDraft = (over: Partial<PricingDraft> = {}): PricingDraft => ({
  ...draftFromPricing(PAID),
  ...over,
});
const freeDraft = (over: Partial<PricingDraft> = {}): PricingDraft => ({
  ...draftFromPricing(FREE_PRICING),
  ...over,
});

describe('ownableFeatureKeys: what an app may grant', () => {
  it('lists only core features whose registry default is off, by their label', () => {
    const keys = ownableFeatureKeys();
    for (const k of keys) expect(PLAN_FEATURE_KEYS).toContain(k);
    expect(keys).toContain('calling');
    expect(keys).toContain('automation');
    // on by default for every plan row: an app granting it would sell what everyone has
    expect(keys).not.toContain('marketplace');
    expect(keys).not.toContain('sales_pipeline');
    expect(MAX_GRANTED_FEATURES).toBe(10);
    const labels = keys.map((k) => PLAN_FEATURE_LABELS[k as PlanFeatureKey]);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });
});

describe('draftFromPricing', () => {
  it('makes text of every stored value, empty for none', () => {
    expect(draftFromPricing(PAID)).toEqual({
      model: 'paid_monthly',
      amount: '9.00',
      currency: 'USD',
      annualAmount: '90.00',
      trialDays: '14',
      purchasable: true,
      includedPlanFeature: 'analytics',
      includedMinPlan: 'scale',
      grantsPlanFeatures: ['calling'],
      grandfatherExisting: true,
    });
    expect(draftFromPricing(FREE_PRICING)).toEqual({
      model: 'free',
      amount: '',
      currency: '',
      annualAmount: '',
      trialDays: '0',
      purchasable: true,
      includedPlanFeature: '',
      includedMinPlan: '',
      grantsPlanFeatures: [],
      grandfatherExisting: false,
    });
  });
});

describe('pricingPayload: the PUT body', () => {
  it('a paid app sends the cleaned values and the rowVersion it read', () => {
    expect(
      pricingPayload(
        paidDraft({
          amount: ' 9 ',
          currency: ' usd ',
          annualAmount: '',
          trialDays: '007',
          includedPlanFeature: '',
          includedMinPlan: ' scale ',
        }),
        4,
      ),
    ).toEqual({
      rowVersion: 4,
      model: 'paid_monthly',
      amount: '9.00',
      currency: 'USD',
      annualAmount: null,
      trialDays: 7,
      purchasable: true,
      includedPlanFeature: null,
      includedMinPlan: 'scale',
      grantsPlanFeatures: ['calling'],
      grandfatherExisting: true,
    });
  });

  it('sends the granted features sorted, so the same set in another order is the same body', () => {
    const a = pricingPayload(
      paidDraft({ grantsPlanFeatures: ['calling', 'automation'], includedPlanFeature: '' }),
      1,
    );
    const b = pricingPayload(
      paidDraft({ grantsPlanFeatures: ['automation', 'calling'], includedPlanFeature: '' }),
      1,
    );
    expect(a.grantsPlanFeatures).toEqual(['automation', 'calling']);
    expect(a).toEqual(b);
  });

  it('fills the missing decimals of a price and keeps the sale switch', () => {
    const p = pricingPayload(
      paidDraft({ amount: '12.5', annualAmount: '100', purchasable: false }),
      1,
    );
    expect(p).toMatchObject({ amount: '12.50', annualAmount: '100.00', purchasable: false });
  });

  it('a free app sends none of the paid fields, even ones left in the form', () => {
    const p = pricingPayload(
      paidDraft({ model: 'free', amount: '9.00', currency: 'USD', purchasable: false }),
      2,
    );
    expect(p).toEqual({
      rowVersion: 2,
      model: 'free',
      trialDays: 0,
      purchasable: true,
      grantsPlanFeatures: [],
      grandfatherExisting: false,
    });
  });

  it('an empty trial field means no trial', () => {
    expect(pricingPayload(paidDraft({ trialDays: '' }), 1).trialDays).toBe(0);
  });

  it('every body a valid draft makes is accepted by the contract', () => {
    for (const d of [
      paidDraft(),
      paidDraft({ amount: '0.01', annualAmount: '', trialDays: '90' }),
      paidDraft({ amount: '9999999999.99', includedPlanFeature: '', includedMinPlan: '' }),
      freeDraft(),
      paidDraft({ model: 'free' }),
    ]) {
      const parsed = setMarketPricingSchema.safeParse(pricingPayload(d, 1));
      expect(parsed.success, JSON.stringify(d)).toBe(true);
    }
  });
});

describe('pricingProblems mirrors the contract', () => {
  it('flags nothing on a valid paid draft and on any free draft', () => {
    expect(pricingProblems(paidDraft())).toEqual({});
    expect(pricingProblems(freeDraft())).toEqual({});
    expect(pricingProblems(paidDraft({ model: 'free', amount: 'junk', trialDays: '999' }))).toEqual(
      {},
    );
  });

  it('names the problem of each field by code', () => {
    expect(pricingProblems(paidDraft({ amount: '' })).amount).toBe('priceRequired');
    expect(pricingProblems(paidDraft({ amount: '9,99' })).amount).toBe('priceFormat');
    expect(pricingProblems(paidDraft({ amount: '9.999' })).amount).toBe('priceFormat');
    expect(pricingProblems(paidDraft({ amount: '-3' })).amount).toBe('priceFormat');
    expect(pricingProblems(paidDraft({ amount: '0' })).amount).toBe('pricePositive');
    expect(pricingProblems(paidDraft({ amount: '0.00' })).amount).toBe('pricePositive');
    expect(pricingProblems(paidDraft({ currency: '' })).currency).toBe('currencyRequired');
    expect(pricingProblems(paidDraft({ currency: 'US' })).currency).toBe('currencyFormat');
    expect(pricingProblems(paidDraft({ currency: 'usd' })).currency).toBeUndefined();
    expect(pricingProblems(paidDraft({ annualAmount: 'x' })).annualAmount).toBe('yearlyFormat');
    expect(pricingProblems(paidDraft({ annualAmount: '0' })).annualAmount).toBe('yearlyPositive');
    expect(pricingProblems(paidDraft({ annualAmount: '' })).annualAmount).toBeUndefined();
    expect(pricingProblems(paidDraft({ trialDays: '91' })).trialDays).toBe('trialRange');
    expect(pricingProblems(paidDraft({ trialDays: '-1' })).trialDays).toBe('trialRange');
    expect(pricingProblems(paidDraft({ trialDays: '1.5' })).trialDays).toBe('trialRange');
    expect(pricingProblems(paidDraft({ trialDays: String(MARKET_TRIAL_DAYS_MAX) })).trialDays).toBe(
      undefined,
    );
    expect(
      pricingProblems(paidDraft({ includedPlanFeature: 'Has Spaces' })).includedPlanFeature,
    ).toBe('featureFormat');
    expect(pricingProblems(paidDraft({ includedMinPlan: 'Pro Plan' })).includedMinPlan).toBe(
      'planFormat',
    );
  });

  it('has a code, and only those codes, for every field it can flag', () => {
    const seen = new Set<string>();
    for (const d of [
      paidDraft({ amount: '' }),
      paidDraft({ amount: 'x' }),
      paidDraft({ amount: '0' }),
      paidDraft({ currency: '' }),
      paidDraft({ currency: 'EURO' }),
      paidDraft({ annualAmount: 'x' }),
      paidDraft({ annualAmount: '0' }),
      paidDraft({ trialDays: '200' }),
      paidDraft({ includedPlanFeature: 'A' }),
      paidDraft({ includedMinPlan: 'A B' }),
      paidDraft({ grantsPlanFeatures: ['A'] }),
      paidDraft({ grantsPlanFeatures: [], grandfatherExisting: true }),
      paidDraft({ includedPlanFeature: 'calling' }),
    ]) {
      for (const [field, code] of Object.entries(pricingProblems(d))) {
        expect(PRICING_FIELDS).toContain(field);
        seen.add(code);
      }
    }
    expect([...seen].sort()).toEqual([...PRICING_PROBLEM_CODES].sort());
  });

  it('agrees with the contract on a grid of drafts: a draft with no problem is accepted, one with a problem is refused', () => {
    const amounts = ['', '9', '9.00', '0', '0.00', '9.999', 'abc', '1e3', '10000000000'];
    const currencies = ['', 'USD', 'usd', 'US', 'USDX', 'U5D'];
    const annuals = ['', '90', '0', 'x'];
    const trials = ['', '0', '14', '90', '91', '-1', '2.5', 'ab'];
    const features = ['', 'analytics', 'Bad Key', '1abc'];
    const plans = ['', 'scale', 'Bad Plan'];
    let checked = 0;
    for (const amount of amounts)
      for (const currency of currencies)
        for (const annualAmount of annuals)
          for (const trialDays of trials)
            for (const includedPlanFeature of features)
              for (const includedMinPlan of plans) {
                const d = paidDraft({
                  amount,
                  currency,
                  annualAmount,
                  trialDays,
                  includedPlanFeature,
                  includedMinPlan,
                });
                const mine = !hasPricingProblems(pricingProblems(d));
                const theirs = setMarketPricingSchema.safeParse(pricingPayload(d, 1)).success;
                expect(mine, JSON.stringify(d)).toBe(theirs);
                checked += 1;
              }
    expect(checked).toBe(amounts.length * 6 * 4 * 8 * 4 * 3);
  });

  it('flags the granted features the way the contract does', () => {
    expect(pricingProblems(paidDraft({ grantsPlanFeatures: ['Bad Key'] })).grantsPlanFeatures).toBe(
      'grantsInvalid',
    );
    expect(
      pricingProblems(paidDraft({ grantsPlanFeatures: ['calling', 'calling'] })).grantsPlanFeatures,
    ).toBe('grantsInvalid');
    const eleven = Array.from({ length: 11 }, (_, i) => `feature_${i}`);
    expect(pricingProblems(paidDraft({ grantsPlanFeatures: eleven })).grantsPlanFeatures).toBe(
      'grantsInvalid',
    );
    expect(
      pricingProblems(paidDraft({ grantsPlanFeatures: [], grandfatherExisting: true }))
        .grandfatherExisting,
    ).toBe('grandfatherNeedsGrants');
    expect(
      pricingProblems(paidDraft({ grantsPlanFeatures: [], grandfatherExisting: false })),
    ).toEqual({});
    expect(
      pricingProblems(
        paidDraft({ includedPlanFeature: 'calling', grantsPlanFeatures: ['calling'] }),
      ).includedPlanFeature,
    ).toBe('includedGranted');
  });

  it('agrees with the contract on a grid of granted features and the grandfather switch', () => {
    const grants = [
      [],
      ['calling'],
      ['calling', 'automation'],
      ['calling', 'calling'],
      ['Bad Key'],
      [' calling '],
      Array.from({ length: 10 }, (_, i) => `feature_${i}`),
      Array.from({ length: 11 }, (_, i) => `feature_${i}`),
    ];
    for (const grantsPlanFeatures of grants)
      for (const grandfatherExisting of [false, true])
        for (const includedPlanFeature of ['', 'calling', 'analytics'])
          for (const model of ['free', 'paid_monthly'] as const) {
            const d = paidDraft({
              model,
              grantsPlanFeatures,
              grandfatherExisting,
              includedPlanFeature,
            });
            const mine = !hasPricingProblems(pricingProblems(d));
            const theirs = setMarketPricingSchema.safeParse(pricingPayload(d, 1)).success;
            expect(mine, JSON.stringify(d)).toBe(theirs);
          }
  });

  it('the contract names the same granted-feature fields as the form', () => {
    const issues = pricingIssues({
      model: 'paid_monthly',
      amount: '9.00',
      currency: 'USD',
      grantsPlanFeatures: [],
      grandfatherExisting: true,
    });
    expect(issues.map((i) => i.path)).toEqual(['grandfatherExisting']);
  });

  it('the contract itself flags the same fields as the form does for a price below zero or none', () => {
    const issues = pricingIssues({ model: 'paid_monthly', amount: '0', currency: null });
    expect(issues.map((i) => i.path).sort()).toEqual(['amount', 'currency']);
    expect(Object.keys(pricingProblems(paidDraft({ amount: '0', currency: '' }))).sort()).toEqual([
      'amount',
      'currency',
    ]);
  });
});

describe('isPricingDirty', () => {
  it('is false for the same drafts and for text that means the same thing', () => {
    expect(isPricingDirty(paidDraft(), paidDraft())).toBe(false);
    expect(isPricingDirty(paidDraft(), paidDraft({ amount: '9' }))).toBe(false);
    expect(isPricingDirty(paidDraft(), paidDraft({ currency: 'usd ' }))).toBe(false);
    expect(isPricingDirty(paidDraft(), paidDraft({ trialDays: '014' }))).toBe(false);
    expect(isPricingDirty(paidDraft({ trialDays: '0' }), paidDraft({ trialDays: '' }))).toBe(false);
  });

  it('is true when a value that would be saved changes', () => {
    expect(isPricingDirty(paidDraft(), paidDraft({ amount: '10' }))).toBe(true);
    expect(isPricingDirty(paidDraft(), paidDraft({ currency: 'EUR' }))).toBe(true);
    expect(isPricingDirty(paidDraft(), paidDraft({ purchasable: false }))).toBe(true);
    expect(isPricingDirty(paidDraft(), paidDraft({ includedMinPlan: '' }))).toBe(true);
    expect(isPricingDirty(paidDraft(), paidDraft({ model: 'free' }))).toBe(true);
    expect(isPricingDirty(freeDraft(), freeDraft({ model: 'paid_monthly' }))).toBe(true);
  });

  it('a granted feature added or removed, or the grandfather switch, is a change; the order of the features is not', () => {
    const two = paidDraft({ grantsPlanFeatures: ['calling', 'automation'] });
    expect(isPricingDirty(paidDraft(), two)).toBe(true);
    expect(isPricingDirty(two, paidDraft({ grantsPlanFeatures: ['automation', 'calling'] }))).toBe(
      false,
    );
    expect(isPricingDirty(paidDraft(), paidDraft({ grandfatherExisting: false }))).toBe(true);
  });

  it('typing bad text into a trial field counts as a change, so the screen can say what is wrong', () => {
    expect(isPricingDirty(paidDraft(), paidDraft({ trialDays: 'abc' }))).toBe(true);
  });

  it('a free app ignores paid fields typed and then abandoned', () => {
    expect(isPricingDirty(freeDraft(), freeDraft({ amount: '5', currency: 'USD' }))).toBe(false);
    const toggled = paidDraft({ model: 'free' });
    expect(isPricingDirty(toggled, paidDraft({ model: 'free', amount: '1' }))).toBe(false);
  });
});

describe('pricingServerFields: the 422 mapped to the form', () => {
  const field = (path: string, message: string) => ({ target: 'field' as const, path, message });

  it('sends each refused path to its field and keeps the first message of a field', () => {
    const { fields, rest } = pricingServerFields([
      field('currency', 'This currency is not enabled on the platform.'),
      field('includedMinPlan', 'There is no such plan.'),
      field('currency', 'second message'),
      field('includedPlanFeature', 'This is not a plan feature.'),
    ]);
    expect(fields).toEqual({
      currency: 'This currency is not enabled on the platform.',
      includedMinPlan: 'There is no such plan.',
      includedPlanFeature: 'This is not a plan feature.',
    });
    expect(rest).toEqual([]);
  });

  it('sends the refusal of one granted feature to the list, and the grandfather refusal to its switch', () => {
    const { fields, rest } = pricingServerFields([
      field('grantsPlanFeatures', 'Only a first-party app can grant plan features.'),
      field('grantsPlanFeatures.1', 'automation is on by default'),
      field('grandfatherExisting', 'Name the plan features the app grants.'),
    ]);
    expect(fields).toEqual({
      grantsPlanFeatures: 'Only a first-party app can grant plan features.',
      grandfatherExisting: 'Name the plan features the app grants.',
    });
    expect(rest).toEqual([]);
    expect(
      pricingServerFields([field('grantsPlanFeatures.0', 'x is not a plan feature.')]).fields,
    ).toEqual({ grantsPlanFeatures: 'x is not a plan feature.' });
  });

  it('keeps a path that is not a form field apart', () => {
    const { fields, rest } = pricingServerFields([
      field('amount', 'Set a monthly price above zero.'),
      field('model', 'Invalid enum value'),
      { target: 'manifest', path: 'amount', message: 'not a form field' },
    ]);
    expect(fields).toEqual({ amount: 'Set a monthly price above zero.' });
    expect(rest.map((p) => p.path)).toEqual(['model', 'amount']);
  });
});

describe('pricingConfirmation: when saving asks first', () => {
  const to = (amount: string, currency = 'USD') => ({
    model: 'paid_monthly' as const,
    amount,
    currency,
  });

  it('asks when the monthly price changes while workspaces subscribe', () => {
    expect(pricingConfirmation(PAID, to('12.00'), 3)).toEqual({
      kind: 'priceChange',
      subscribers: 3,
      from: { amount: '9.00', currency: 'USD' },
      to: { amount: '12.00', currency: 'USD' },
    });
  });

  it('asks when the currency changes', () => {
    expect(pricingConfirmation(PAID, to('9.00', 'EUR'), 1)).toMatchObject({ kind: 'priceChange' });
  });

  it('asks when a paid app goes back to free while workspaces subscribe', () => {
    expect(pricingConfirmation(PAID, { model: 'free' }, 2)).toEqual({
      kind: 'toFree',
      subscribers: 2,
    });
  });

  it('does not ask when nobody subscribes', () => {
    expect(pricingConfirmation(PAID, to('12.00'), 0)).toBeNull();
    expect(pricingConfirmation(PAID, { model: 'free' }, 0)).toBeNull();
  });

  it('does not ask for changes a subscriber would not feel', () => {
    expect(pricingConfirmation(PAID, to('9.00'), 5)).toBeNull();
  });

  it('does not ask when the app was not paid before', () => {
    expect(pricingConfirmation(FREE_PRICING, to('9.00'), 5)).toBeNull();
    expect(pricingConfirmation(FREE_PRICING, { model: 'free' }, 5)).toBeNull();
  });

  it('compares the price the form will send, so "9" is not a change from "9.00"', () => {
    const payload = pricingPayload(paidDraft({ amount: '9' }), 1);
    expect(pricingConfirmation(PAID, payload, 4)).toBeNull();
    expect(
      pricingConfirmation(PAID, pricingPayload(paidDraft({ amount: '9.5' }), 1), 4),
    ).toMatchObject({ kind: 'priceChange', to: { amount: '9.50' } });
  });
});

describe('formatMoney and priceLabel', () => {
  it('writes a price the way the language does', () => {
    expect(formatMoney('9.00', 'USD', 'en')).toBe('$9.00');
    expect(formatMoney('1234.5', 'USD', 'en')).toBe('$1,234.50');
    expect(formatMoney('9.00', 'EUR', 'en')).toBe('€9.00');
  });

  it('shows a dash when there is no price, and the code when the runtime does not know it', () => {
    expect(formatMoney(null, 'USD', 'en')).toBe('-');
    expect(formatMoney('9.00', null, 'en')).toBe('-');
    expect(formatMoney('', 'USD', 'en')).toBe('-');
    expect(formatMoney('9.00', 'US', 'en')).toBe('US 9.00');
  });

  it('a free app is free', () => {
    expect(priceLabel(FREE_PRICING, 'en')).toEqual({ kind: 'free' });
  });

  it('a paid app has its price, trial, sale state and yearly price', () => {
    expect(priceLabel(PAID, 'en')).toEqual({
      kind: 'paid',
      price: '$9.00',
      trialDays: 14,
      onSale: true,
      yearly: '$90.00',
    });
    expect(
      priceLabel({ ...PAID, purchasable: false, annualAmount: null, trialDays: 0 }, 'en'),
    ).toEqual({ kind: 'paid', price: '$9.00', trialDays: 0, onSale: false, yearly: null });
  });

  it('suggests common currency codes, all three letters and unique', () => {
    for (const c of COMMON_CURRENCIES) expect(c).toMatch(/^[A-Z]{3}$/);
    expect(new Set(COMMON_CURRENCIES).size).toBe(COMMON_CURRENCIES.length);
    expect(COMMON_CURRENCIES).toContain('USD');
  });
});

describe('formatMrr', () => {
  it('one line per currency, never added across currencies', () => {
    expect(
      formatMrr(
        [
          { currency: 'EUR', amount: '40.00' },
          { currency: 'USD', amount: '120.00' },
        ],
        'en',
      ),
    ).toEqual(['€40.00', '$120.00']);
    expect(formatMrr([], 'en')).toEqual([]);
  });
});
