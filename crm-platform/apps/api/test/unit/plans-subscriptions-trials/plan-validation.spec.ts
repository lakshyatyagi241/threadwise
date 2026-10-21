import { describe, expect, it } from 'vitest';
import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  checkPlanRules,
  createPlanRequestSchema,
  isMoney,
  isZeroMoney,
  moneyCents,
  normaliseMoney,
  planSlugSchema,
  readPlanLock,
  setPlanActiveRequestSchema,
  updatePlanRequestSchema,
  type PlanRuleCode,
  type PlanRuleInput,
} from '@crm/contracts';

const rules = (over: Partial<PlanRuleInput>): PlanRuleInput => ({
  amount: '19.00',
  offerAmount: null,
  isFree: false,
  isCustomQuote: false,
  isDefault: false,
  isActive: true,
  ...over,
});
const codes = (over: Partial<PlanRuleInput>): PlanRuleCode[] =>
  checkPlanRules(rules(over)).map((i) => i.code);

describe('money helpers', () => {
  it('accepts up to ten whole digits and two decimals, nothing else', () => {
    for (const ok of ['0', '19', '19.5', '19.99', '0.01', '1234567890', '007']) {
      expect(isMoney(ok), ok).toBe(true);
    }
    for (const bad of [
      '',
      '-1',
      '1.',
      '.5',
      '1.999',
      'abc',
      '1e3',
      '12345678901',
      '1,5',
      ' 1',
      '1 ',
    ]) {
      expect(isMoney(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('normalises to exactly two decimals and strips leading zeros', () => {
    expect(normaliseMoney('19')).toBe('19.00');
    expect(normaliseMoney('19.5')).toBe('19.50');
    expect(normaliseMoney('19.99')).toBe('19.99');
    expect(normaliseMoney('0')).toBe('0.00');
    expect(normaliseMoney('007')).toBe('7.00');
    expect(normaliseMoney('0.5')).toBe('0.50');
  });

  it('converts to integer cents for exact comparison', () => {
    expect(moneyCents('19.99')).toBe(1999);
    expect(moneyCents('19.5')).toBe(1950);
    expect(moneyCents('0.10')).toBe(10);
    expect(moneyCents('0.1')).toBe(10);
    expect(moneyCents('100')).toBe(10000);
    // The classic float trap: 0.1 + 0.2 style sums never appear because nothing is a float.
    expect(moneyCents('0.30')).toBe(30);
  });

  it('treats a missing or zero amount as zero money', () => {
    expect(isZeroMoney(null)).toBe(true);
    expect(isZeroMoney(undefined)).toBe(true);
    expect(isZeroMoney('0')).toBe(true);
    expect(isZeroMoney('0.00')).toBe(true);
    expect(isZeroMoney('0.01')).toBe(false);
  });
});

describe('planSlugSchema', () => {
  it('lowercases and trims, then accepts 1 to 32 letters, digits or underscores with a letter', () => {
    expect(planSlugSchema.parse('  Pro_Plus ')).toBe('pro_plus');
    expect(planSlugSchema.parse('a')).toBe('a');
    expect(planSlugSchema.parse('_a_')).toBe('_a_');
    expect(planSlugSchema.parse('1a')).toBe('1a');
    expect(planSlugSchema.parse('a'.repeat(32))).toBe('a'.repeat(32));
  });

  it('refuses a bare number, an empty slug, spaces, dashes, symbols and more than 32 characters', () => {
    for (const bad of [
      '',
      '12345',
      '0',
      '_',
      '__',
      'pro plus',
      'pro-plus',
      'pro.plus',
      'plán',
      'a'.repeat(33),
    ]) {
      expect(planSlugSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('explains an all-digit slug as needing a letter', () => {
    const res = planSlugSchema.safeParse('2024');
    expect(res.success).toBe(false);
    if (!res.success)
      expect(res.error.issues.map((i) => i.message)).toContain('A slug needs at least one letter.');
  });
});

describe('checkPlanRules', () => {
  it('passes a plain paid plan, a free plan, a custom quote, an offer plan and an active default', () => {
    expect(codes({})).toEqual([]);
    expect(codes({ amount: '0.00', isFree: true })).toEqual([]);
    expect(codes({ amount: '0.00', isCustomQuote: true })).toEqual([]);
    expect(codes({ amount: '19.00', offerAmount: '14.99' })).toEqual([]);
    expect(codes({ isDefault: true, isActive: true })).toEqual([]);
  });

  it('a free plan must cost 0', () => {
    const issues = checkPlanRules(rules({ isFree: true, amount: '5.00' }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['free_needs_zero_price', 'amount']]);
    expect(issues[0]?.message).toBeTruthy();
  });

  it('a free plan carries no offer (and the paid-offer rule is not double-reported)', () => {
    const issues = checkPlanRules(rules({ isFree: true, amount: '0.00', offerAmount: '3.00' }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['free_no_offer', 'offerAmount']]);
  });

  it('a custom quote shows no price and no offer', () => {
    expect(codes({ isCustomQuote: true, amount: '5.00' })).toEqual(['custom_no_price']);
    expect(codes({ isCustomQuote: true, amount: '0.00', offerAmount: '1.00' })).toEqual([
      'custom_no_price',
    ]);
  });

  it('a plan cannot be both free and a custom quote', () => {
    const issues = checkPlanRules(rules({ isCustomQuote: true, isFree: true, amount: '0.00' }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom_not_free', 'isFree']]);
  });

  it('a price of 0 must be marked free: a "paid" plan needs a price', () => {
    const issues = checkPlanRules(rules({ amount: '0.00' }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['paid_needs_price', 'amount']]);
    expect(codes({ amount: '0' })).toEqual(['paid_needs_price']);
  });

  it('the offer must be strictly lower than the price', () => {
    expect(codes({ amount: '19.00', offerAmount: '19.00' })).toEqual(['offer_not_lower']);
    expect(codes({ amount: '19.00', offerAmount: '25.00' })).toEqual(['offer_not_lower']);
    expect(codes({ amount: '19.00', offerAmount: '18.99' })).toEqual([]);
  });

  it('compares the offer and the price in cents, whatever their formatting', () => {
    expect(codes({ amount: '19.50', offerAmount: '19.5' })).toEqual(['offer_not_lower']);
    expect(codes({ amount: '19.5', offerAmount: '19.49' })).toEqual([]);
    expect(codes({ amount: '100', offerAmount: '99.99' })).toEqual([]);
    expect(codes({ amount: '9.00', offerAmount: '10' })).toEqual(['offer_not_lower']);
  });

  it('the signup default must be active', () => {
    const issues = checkPlanRules(rules({ isDefault: true, isActive: false }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['default_needs_active', 'isDefault']]);
    expect(codes({ isDefault: false, isActive: false })).toEqual([]);
  });

  it('reports every violation, not only the first', () => {
    expect(
      codes({
        isFree: true,
        amount: '5.00',
        offerAmount: '3.00',
        isDefault: true,
        isActive: false,
      }),
    ).toEqual(['free_needs_zero_price', 'free_no_offer', 'default_needs_active']);
  });
});

describe('createPlanRequestSchema', () => {
  const FREE = { name: 'Free', isFree: true };
  const parse = (over: Record<string, unknown> = {}) =>
    createPlanRequestSchema.safeParse({ ...FREE, ...over });
  const ok = (over: Record<string, unknown> = {}) => {
    const res = parse(over);
    if (!res.success) throw new Error(JSON.stringify(res.error.issues));
    return res.data;
  };
  const paths = (over: Record<string, unknown>) => {
    const res = parse(over);
    return res.success ? [] : res.error.issues.map((i) => i.path.join('.'));
  };

  it('fills every default on a minimal free plan', () => {
    const data = ok();
    expect(data).toMatchObject({
      name: 'Free',
      subtitle: null,
      detail: null,
      amount: '0.00',
      offerAmount: null,
      currency: 'USD',
      billingUnit: 'months',
      billingDuration: 1,
      isFree: true,
      isLifetime: false,
      isActive: true,
      isDefault: false,
      isHighlighted: false,
      isCustomQuote: false,
      sortOrder: 0,
      ctaLabel: 'Get started',
    });
    expect(data.slug).toBeUndefined();
  });

  it('every limit defaults to 0 (unlimited) and every feature to off, each key present', () => {
    const data = ok();
    expect(Object.keys(data.limits).sort()).toEqual([...PLAN_LIMIT_KEYS].sort());
    // `teams` defaults to the unlimited stand-in: a client that omits it must not make the plan solo.
    expect(Object.entries(data.limits).every(([k, v]) => v === (k === 'teams' ? 1_000_000 : 0))).toBe(true);
    expect(Object.keys(data.features).sort()).toEqual([...PLAN_FEATURE_KEYS].sort());
    expect(Object.values(data.features).every((v) => v === false)).toBe(true);
  });

  it('a plan with the default price 0 and no free flag is refused (price 0 must be marked free)', () => {
    const res = createPlanRequestSchema.safeParse({ name: 'Pro' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues).toHaveLength(1);
      expect(res.error.issues[0]?.path).toEqual(['amount']);
    }
  });

  it('normalises money strings to two decimals', () => {
    expect(ok({ isFree: false, amount: '19' }).amount).toBe('19.00');
    expect(ok({ isFree: false, amount: '19.5' }).amount).toBe('19.50');
    expect(ok({ isFree: false, amount: ' 19.99 ' }).amount).toBe('19.99');
    expect(ok({ isFree: false, amount: '007' }).amount).toBe('7.00');
    expect(ok({ isFree: false, amount: '20', offerAmount: '14.5' }).offerAmount).toBe('14.50');
  });

  it('refuses malformed money and non-string amounts', () => {
    for (const bad of ['abc', '', '-5', '19.999', '1e3', '12345678901', 19.99, null]) {
      expect(paths({ isFree: false, amount: bad }), JSON.stringify(bad)).toContain('amount');
    }
    expect(paths({ isFree: false, amount: '20', offerAmount: 'abc' })).toContain('offerAmount');
  });

  it('an offer of 0, 0.00, blank or null means no offer', () => {
    for (const v of ['0', '0.00', '', '   ', null, undefined]) {
      expect(
        ok({ isFree: false, amount: '20', offerAmount: v }).offerAmount,
        JSON.stringify(v),
      ).toBeNull();
    }
    // ...which keeps a free plan valid when the form posts offer "0".
    expect(ok({ offerAmount: '0' }).offerAmount).toBeNull();
  });

  it('a blank subtitle or detail becomes null; text is trimmed', () => {
    expect(ok({ subtitle: '', detail: '   ' })).toMatchObject({ subtitle: null, detail: null });
    expect(ok({ subtitle: '  For teams ', detail: ' All you need ' })).toMatchObject({
      subtitle: 'For teams',
      detail: 'All you need',
    });
    expect(ok({ subtitle: null, detail: null })).toMatchObject({ subtitle: null, detail: null });
  });

  it('bounds the text fields (subtitle 191, detail 5000, name 1 to 120, cta 1 to 64)', () => {
    expect(ok({ subtitle: 'x'.repeat(191) }).subtitle).toHaveLength(191);
    expect(paths({ subtitle: 'x'.repeat(192) })).toContain('subtitle');
    expect(ok({ detail: 'x'.repeat(5000) }).detail).toHaveLength(5000);
    expect(paths({ detail: 'x'.repeat(5001) })).toContain('detail');
    expect(ok({ name: 'n'.repeat(120) }).name).toHaveLength(120);
    expect(paths({ name: 'n'.repeat(121) })).toContain('name');
    expect(paths({ name: '' })).toContain('name');
    expect(paths({ name: '   ' })).toContain('name');
    expect(ok({ name: '  Pro  ' }).name).toBe('Pro');
    expect(ok({ ctaLabel: 'c'.repeat(64) }).ctaLabel).toHaveLength(64);
    expect(paths({ ctaLabel: 'c'.repeat(65) })).toContain('ctaLabel');
    expect(paths({ ctaLabel: '' })).toContain('ctaLabel');
  });

  it('requires a name', () => {
    const res = createPlanRequestSchema.safeParse({ isFree: true });
    expect(res.success).toBe(false);
  });

  it('upper-cases the currency and wants three letters', () => {
    expect(ok({ currency: 'eur' }).currency).toBe('EUR');
    expect(paths({ currency: 'EU' })).toContain('currency');
    expect(paths({ currency: 'EURO' })).toContain('currency');
    expect(paths({ currency: 'E1R' })).toContain('currency');
  });

  it('bounds the billing period, the unit, the sort order and the flags', () => {
    expect(ok({ billingDuration: 120 }).billingDuration).toBe(120);
    expect(paths({ billingDuration: 0 })).toContain('billingDuration');
    expect(paths({ billingDuration: 121 })).toContain('billingDuration');
    expect(paths({ billingDuration: 1.5 })).toContain('billingDuration');
    for (const unit of ['days', 'weeks', 'months', 'years']) {
      expect(ok({ billingUnit: unit }).billingUnit).toBe(unit);
    }
    expect(paths({ billingUnit: 'hours' })).toContain('billingUnit');
    expect(ok({ sortOrder: 100000 }).sortOrder).toBe(100000);
    expect(paths({ sortOrder: -1 })).toContain('sortOrder');
    expect(paths({ sortOrder: 100001 })).toContain('sortOrder');
    expect(paths({ isHighlighted: 'yes' })).toContain('isHighlighted');
  });

  it('limits: a partial object is filled with 0, unknown keys are dropped, bad caps refused', () => {
    const data = ok({ limits: { devices: 5, nonsense: 9 } });
    expect(data.limits.devices).toBe(5);
    expect(data.limits.monthly_messages).toBe(0);
    expect(Object.keys(data.limits)).not.toContain('nonsense');
    expect(paths({ limits: { devices: -1 } })).toContain('limits.devices');
    expect(paths({ limits: { devices: 1.5 } })).toContain('limits.devices');
    expect(paths({ limits: { devices: '5' } })).toContain('limits.devices');
    expect(paths({ limits: { devices: 2_000_000_001 } })).toContain('limits.devices');
    expect(ok({ limits: { devices: 2_000_000_000 } }).limits.devices).toBe(2_000_000_000);
  });

  it('features: a partial object is filled with off, unknown keys are dropped, non-booleans refused', () => {
    const data = ok({ features: { analytics: true, nonsense: true } });
    expect(data.features.analytics).toBe(true);
    expect(data.features.automation).toBe(false);
    expect(Object.keys(data.features)).not.toContain('nonsense');
    expect(paths({ features: { analytics: 'yes' } })).toContain('features.analytics');
    expect(paths({ features: { analytics: 1 } })).toContain('features.analytics');
  });

  describe('slug', () => {
    it('is optional; when given it is lower-cased and trimmed', () => {
      expect(ok({ slug: ' My_Plan ' }).slug).toBe('my_plan');
      expect(ok().slug).toBeUndefined();
    });

    it('refuses a bare number, an empty slug, spaces and more than 32 characters', () => {
      for (const bad of ['12345', '', 'my plan', 'my-plan', 'a'.repeat(33)]) {
        expect(paths({ slug: bad }), JSON.stringify(bad)).toContain('slug');
      }
    });
  });

  describe('cross-field rules become issues on the offending field', () => {
    it('free with a price -> amount', () => {
      expect(paths({ isFree: true, amount: '5' })).toEqual(['amount']);
    });
    it('free with an offer -> offerAmount', () => {
      expect(paths({ isFree: true, offerAmount: '1' })).toEqual(['offerAmount']);
    });
    it('offer not lower than price -> offerAmount', () => {
      expect(paths({ isFree: false, amount: '10', offerAmount: '10' })).toEqual(['offerAmount']);
      expect(ok({ isFree: false, amount: '10', offerAmount: '9.99' }).offerAmount).toBe('9.99');
    });
    it('custom quote with a price -> amount; without one it parses', () => {
      expect(paths({ isFree: false, isCustomQuote: true, amount: '10' })).toEqual(['amount']);
      expect(ok({ isFree: false, isCustomQuote: true }).isCustomQuote).toBe(true);
    });
    it('custom quote that is also free -> isFree', () => {
      expect(paths({ isFree: true, isCustomQuote: true })).toEqual(['isFree']);
    });
    it('a default plan that is inactive -> isDefault', () => {
      expect(paths({ isDefault: true, isActive: false })).toEqual(['isDefault']);
      expect(ok({ isDefault: true, isActive: true }).isDefault).toBe(true);
    });
    it('carries a readable message', () => {
      const res = parse({ isFree: true, amount: '5' });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error.issues[0]?.message).toMatch(/free plan/i);
    });
  });
});

describe('updatePlanRequestSchema (partial semantics)', () => {
  it('an empty patch parses to an empty patch: no defaults are injected', () => {
    expect(updatePlanRequestSchema.parse({})).toEqual({});
  });

  it('keeps only the keys that were sent', () => {
    const got = updatePlanRequestSchema.parse({ name: '  New name ' });
    expect(got).toEqual({ name: 'New name' });
    expect(Object.keys(got)).toEqual(['name']);
  });

  it('normalises what it is given with the same rules as create', () => {
    expect(updatePlanRequestSchema.parse({ amount: '5' })).toEqual({ amount: '5.00' });
    expect(updatePlanRequestSchema.parse({ currency: 'gbp' })).toEqual({ currency: 'GBP' });
    expect(updatePlanRequestSchema.parse({ subtitle: '' })).toEqual({ subtitle: null });
    expect(updatePlanRequestSchema.parse({ detail: '  ' })).toEqual({ detail: null });
  });

  it('an offer of 0 or null explicitly clears the offer', () => {
    expect(updatePlanRequestSchema.parse({ offerAmount: '0' })).toEqual({ offerAmount: null });
    expect(updatePlanRequestSchema.parse({ offerAmount: null })).toEqual({ offerAmount: null });
    expect(updatePlanRequestSchema.parse({ offerAmount: '4.5' })).toEqual({ offerAmount: '4.50' });
  });

  it('a partial limits or features object stays partial (a patch names only what it changes)', () => {
    expect(updatePlanRequestSchema.parse({ limits: { devices: 5 } })).toEqual({
      limits: { devices: 5 },
    });
    expect(updatePlanRequestSchema.parse({ features: { analytics: true } })).toEqual({
      features: { analytics: true },
    });
    expect(updatePlanRequestSchema.parse({ limits: {}, features: {} })).toEqual({
      limits: {},
      features: {},
    });
  });

  it('drops unknown limit and feature keys', () => {
    expect(
      updatePlanRequestSchema.parse({
        limits: { devices: 1, ghost: 3 },
        features: { ghost: true },
      }),
    ).toEqual({ limits: { devices: 1 }, features: {} });
  });

  it('never carries a slug: it is fixed once the plan exists', () => {
    const got = updatePlanRequestSchema.parse({ slug: 'hijack', name: 'Renamed' });
    expect(got).toEqual({ name: 'Renamed' });
    expect('slug' in got).toBe(false);
  });

  it('still refuses invalid values for the keys it is given', () => {
    for (const bad of [
      { amount: 'abc' },
      { amount: '1.234' },
      { name: '' },
      { name: 'n'.repeat(121) },
      { billingDuration: 0 },
      { billingUnit: 'hours' },
      { currency: 'EU' },
      { sortOrder: -1 },
      { limits: { devices: -1 } },
      { features: { analytics: 'yes' } },
      { isActive: 'no' },
    ]) {
      expect(updatePlanRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('does not run the cross-field rules itself: the service re-checks the merged plan', () => {
    // A lone `isFree: true` is fine as a patch; whether the stored price allows it is decided on the merge.
    expect(updatePlanRequestSchema.safeParse({ isFree: true }).success).toBe(true);
    expect(updatePlanRequestSchema.safeParse({ amount: '10', offerAmount: '20' }).success).toBe(
      true,
    );
    expect(updatePlanRequestSchema.safeParse({ isDefault: true, isActive: false }).success).toBe(
      true,
    );
  });
});

describe('setPlanActiveRequestSchema', () => {
  it('wants exactly a boolean isActive', () => {
    expect(setPlanActiveRequestSchema.parse({ isActive: true })).toEqual({ isActive: true });
    expect(setPlanActiveRequestSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(setPlanActiveRequestSchema.safeParse({}).success).toBe(false);
    expect(setPlanActiveRequestSchema.safeParse({ isActive: 'yes' }).success).toBe(false);
    expect(setPlanActiveRequestSchema.safeParse({ isActive: null }).success).toBe(false);
  });
});

describe('readPlanLock (the 422 plan-gate payload)', () => {
  it('reads a feature lock', () => {
    expect(
      readPlanLock([
        { path: 'feature', message: 'remove_branding' },
        { path: 'reason', message: 'feature_disabled' },
        { path: 'upgradeUrl', message: '/account/plans' },
      ]),
    ).toEqual({
      reason: 'feature_disabled',
      key: 'remove_branding',
      upgradeUrl: '/account/plans',
      used: null,
      limit: null,
    });
  });

  it('reads a limit lock with the numbers', () => {
    expect(
      readPlanLock([
        { path: 'limit', message: 'devices' },
        { path: 'reason', message: 'limit_reached' },
        { path: 'used', message: '3' },
        { path: 'limitValue', message: '3' },
        { path: 'upgradeUrl', message: '/billing' },
      ]),
    ).toEqual({
      reason: 'limit_reached',
      key: 'devices',
      upgradeUrl: '/billing',
      used: 3,
      limit: 3,
    });
  });

  it('falls back to the in-app plan picker when no upgrade url is given', () => {
    expect(
      readPlanLock([
        { path: 'feature', message: 'calling' },
        { path: 'reason', message: 'feature_disabled' },
      ])?.upgradeUrl,
    ).toBe('/account/plans');
  });

  it('is null when it is not a plan lock', () => {
    expect(readPlanLock(undefined)).toBeNull();
    expect(readPlanLock([])).toBeNull();
    expect(readPlanLock([{ path: 'email', message: 'invalid' }])).toBeNull();
    expect(readPlanLock([{ path: 'reason', message: 'feature_disabled' }])).toBeNull();
    expect(
      readPlanLock([
        { path: 'feature', message: 'calling' },
        { path: 'reason', message: 'something_else' },
      ]),
    ).toBeNull();
  });

  it('reads a non-numeric count as unknown rather than guessing', () => {
    const lock = readPlanLock([
      { path: 'limit', message: 'users' },
      { path: 'reason', message: 'limit_reached' },
      { path: 'used', message: 'many' },
      { path: 'limitValue', message: '-1' },
    ]);
    expect(lock).toMatchObject({ used: null, limit: null });
  });
});
