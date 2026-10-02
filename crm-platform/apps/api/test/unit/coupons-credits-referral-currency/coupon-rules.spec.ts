import { describe, expect, it } from 'vitest';
import {
  COUPON_MESSAGES,
  amountToMinor,
  discountFor,
  resolveCoupon,
  type BuyerFacts,
  type CouponFacts,
} from '../../../src/modules/coupons-credits-referral-currency/coupon-rules';

const NOW = new Date('2026-10-01T12:00:00Z');

const coupon = (over: Partial<CouponFacts> = {}): CouponFacts => ({
  id: 1,
  code: 'WELCOME10',
  type: 'percent',
  amount: '10.0000',
  maxDiscountAmount: null,
  minOrderAmount: null,
  currencyCode: null,
  maxUses: null,
  usesCount: 0,
  perUserLimit: null,
  applicablePlanSlugs: [],
  startsAt: null,
  expiresAt: null,
  isActive: true,
  firstPurchaseOnly: false,
  stackableWithOther: false,
  ...over,
});
const buyer = (over: Partial<BuyerFacts> = {}): BuyerFacts => ({
  paidOrders: 0,
  redemptions: 0,
  ...over,
});
const input = (over: Record<string, unknown> = {}) => ({
  planSlug: 'growth',
  subtotalMinor: 10_000n,
  currency: 'USD',
  now: NOW,
  ...over,
});
const run = (
  c: CouponFacts | null,
  b: BuyerFacts | null = buyer(),
  i = input(),
  code = 'WELCOME10',
) => resolveCoupon(code, c, b, i);

describe('TW-CPN-006 coupon engine: the discount', () => {
  it('a 20% coupon capped at 50 on an order of 1000 discounts 50', () => {
    const r = run(
      coupon({ amount: '20', maxDiscountAmount: '50' }),
      buyer(),
      input({ subtotalMinor: 100_000n }),
    );
    expect(r).toMatchObject({ ok: true, discountMinor: 5_000n, message: 'Coupon applied.' });
  });

  it('a fixed 500 coupon on an order of 300 discounts 300: never above the order', () => {
    const r = run(
      coupon({ type: 'fixed', amount: '500' }),
      buyer(),
      input({ subtotalMinor: 30_000n }),
    );
    expect(r).toMatchObject({ ok: true, discountMinor: 30_000n });
  });

  it('the cap applies to percent coupons only', () => {
    const fixed = run(coupon({ type: 'fixed', amount: '30', maxDiscountAmount: '5' }));
    expect(fixed).toMatchObject({ ok: true, discountMinor: 3_000n });
    const pct = run(coupon({ amount: '50', maxDiscountAmount: '5' }));
    expect(pct).toMatchObject({ ok: true, discountMinor: 500n });
  });

  it('a cap of 0 means no cap, and percent above 100 never discounts more than the order', () => {
    expect(run(coupon({ amount: '20', maxDiscountAmount: '0' }))).toMatchObject({
      discountMinor: 2_000n,
    });
    expect(run(coupon({ amount: '150' }))).toMatchObject({ ok: true, discountMinor: 10_000n });
  });

  it('rounds half up to the currency minor unit: 33.33% of 10.01 is 3.34', () => {
    const r = run(coupon({ amount: '33.33' }), buyer(), input({ subtotalMinor: 1_001n }));
    expect(r).toMatchObject({ ok: true, discountMinor: 334n });
  });

  it('follows the currency exponent: whole yen, three-decimal dinar', () => {
    expect(discountFor(coupon({ amount: '10' }), 15_005n, 'JPY')).toBe(1_501n);
    expect(discountFor(coupon({ type: 'fixed', amount: '1.5' }), 100_000n, 'KWD')).toBe(1_500n);
    expect(amountToMinor('19.99', 'USD')).toBe(1_999n);
    expect(amountToMinor('499.5000', 'JPY')).toBe(500n);
  });

  it('a discount that comes to nothing is refused', () => {
    expect(run(coupon({ type: 'fixed', amount: '0' }))).toEqual({
      ok: false,
      message: COUPON_MESSAGES.noDiscount,
    });
    expect(run(coupon(), buyer(), input({ subtotalMinor: 0n }))).toEqual({
      ok: false,
      message: 'Coupon yielded no discount.',
    });
  });
});

describe('TW-CPN-006 coupon engine: the rules, in Reference order', () => {
  it('refuses an empty code, then an unknown one', () => {
    expect(run(null, null, input(), '   ')).toEqual({ ok: false, message: 'Enter a coupon code.' });
    expect(run(null, null, input(), ' nope ')).toEqual({
      ok: false,
      message: 'Coupon "NOPE" not recognised.',
    });
  });

  it('is case- and space-insensitive', () => {
    expect(resolveCoupon(' welcome10 ', coupon(), buyer(), input())).toMatchObject({ ok: true });
  });

  it('refuses a disabled coupon before anything else', () => {
    const c = coupon({
      isActive: false,
      expiresAt: new Date('2020-01-01'),
      maxUses: 1,
      usesCount: 5,
    });
    expect(run(c)).toEqual({ ok: false, message: 'This coupon is disabled.' });
  });

  it('checks the window: not active yet, expired (inclusive to the instant)', () => {
    expect(run(coupon({ startsAt: new Date('2026-10-02T00:00:00Z') }))).toEqual({
      ok: false,
      message: 'This coupon is not active yet.',
    });
    expect(run(coupon({ expiresAt: new Date('2026-09-30T00:00:00Z') }))).toEqual({
      ok: false,
      message: 'This coupon has expired.',
    });
    expect(run(coupon({ expiresAt: NOW }))).toMatchObject({ ok: true });
    expect(run(coupon({ startsAt: NOW }))).toMatchObject({ ok: true });
  });

  it('refuses a coupon that has reached its global cap; null is unlimited', () => {
    expect(run(coupon({ maxUses: 5, usesCount: 5 }))).toEqual({
      ok: false,
      message: 'This coupon is fully used.',
    });
    expect(run(coupon({ maxUses: 5, usesCount: 4 }))).toMatchObject({ ok: true });
    expect(run(coupon({ maxUses: null, usesCount: 999 }))).toMatchObject({ ok: true });
  });

  it('locks to a currency: INR coupon on a USD order is refused; no order currency skips the lock', () => {
    const c = coupon({ currencyCode: 'inr' });
    expect(run(c)).toEqual({
      ok: false,
      message: 'This coupon is only valid for payments in INR.',
    });
    expect(run(c, buyer(), input({ currency: 'inr' }))).toMatchObject({ ok: true });
    expect(run(c, buyer(), input({ currency: '' }))).toMatchObject({ ok: true });
  });

  it('refuses stacking a non-stackable coupon with a different code, but not with itself', () => {
    expect(run(coupon(), buyer(), input({ otherCoupons: ['SAVE20'] }))).toEqual({
      ok: false,
      message: 'This coupon cannot be combined with another coupon.',
    });
    expect(run(coupon(), buyer(), input({ otherCoupons: ['welcome10', ' '] }))).toMatchObject({
      ok: true,
    });
    expect(
      run(coupon({ stackableWithOther: true }), buyer(), input({ otherCoupons: ['SAVE20'] })),
    ).toMatchObject({
      ok: true,
    });
  });

  it('first purchase only: any paid order of the buyer refuses; none (or only unpaid) accepts', () => {
    const c = coupon({ firstPurchaseOnly: true });
    expect(run(c, buyer({ paidOrders: 1 }))).toEqual({
      ok: false,
      message: 'This coupon is valid on your first purchase only.',
    });
    expect(run(c, buyer({ paidOrders: 0 }))).toMatchObject({ ok: true });
    // No identified buyer: the per-customer rules are skipped, as Reference's callers without a user.
    expect(run(c, null)).toMatchObject({ ok: true });
  });

  it('per-user limit: refused once the buyer has used it that many times', () => {
    const c = coupon({ perUserLimit: 1 });
    expect(run(c, buyer({ redemptions: 1 }))).toEqual({
      ok: false,
      message: 'You have already used this coupon the maximum number of times.',
    });
    expect(run(c, buyer({ redemptions: 0 }))).toMatchObject({ ok: true });
    expect(run(coupon({ perUserLimit: 2 }), buyer({ redemptions: 1 }))).toMatchObject({ ok: true });
  });

  it('minimum order compares exactly at the coupon four decimals', () => {
    const c = coupon({ minOrderAmount: '100' });
    expect(run(c, buyer(), input({ subtotalMinor: 9_999n }))).toEqual({
      ok: false,
      message: 'Order is below the coupon minimum.',
    });
    expect(run(c, buyer(), input({ subtotalMinor: 10_000n }))).toMatchObject({ ok: true });
    // 99.995 is not rounded down into a pass: 99.99 is below it, 100.00 is above it.
    expect(
      run(coupon({ minOrderAmount: '99.995' }), buyer(), input({ subtotalMinor: 9_999n })).ok,
    ).toBe(false);
    expect(
      run(coupon({ minOrderAmount: '99.995' }), buyer(), input({ subtotalMinor: 10_000n })).ok,
    ).toBe(true);
    expect(
      run(coupon({ minOrderAmount: '100.005' }), buyer(), input({ subtotalMinor: 10_000n })),
    ).toMatchObject({
      ok: false,
    });
  });

  it('plan restriction: a listed slug passes, another is refused, an empty list means any plan', () => {
    const c = coupon({ applicablePlanSlugs: ['pro', 'scale'] });
    expect(run(c, buyer(), input({ planSlug: 'growth' }))).toEqual({
      ok: false,
      message: 'This coupon does not apply to this plan.',
    });
    expect(run(c, buyer(), input({ planSlug: 'pro' }))).toMatchObject({ ok: true });
    expect(
      run(coupon({ applicablePlanSlugs: [] }), buyer(), input({ planSlug: 'anything' })),
    ).toMatchObject({
      ok: true,
    });
  });

  it('reports the FIRST failing rule in Reference order', () => {
    const c = coupon({
      maxUses: 1,
      usesCount: 1,
      currencyCode: 'INR',
      firstPurchaseOnly: true,
      minOrderAmount: '999999',
      applicablePlanSlugs: ['other'],
    });
    expect(run(c, buyer({ paidOrders: 3 })).ok).toBe(false);
    expect(run(c, buyer({ paidOrders: 3 }))).toEqual({
      ok: false,
      message: 'This coupon is fully used.',
    });
    expect(run({ ...c, maxUses: null }, buyer({ paidOrders: 3 }))).toEqual({
      ok: false,
      message: 'This coupon is only valid for payments in INR.',
    });
    expect(run({ ...c, maxUses: null, currencyCode: null }, buyer({ paidOrders: 3 }))).toEqual({
      ok: false,
      message: 'This coupon is valid on your first purchase only.',
    });
    expect(run({ ...c, maxUses: null, currencyCode: null, firstPurchaseOnly: false })).toEqual({
      ok: false,
      message: 'Order is below the coupon minimum.',
    });
    expect(
      run({
        ...c,
        maxUses: null,
        currencyCode: null,
        firstPurchaseOnly: false,
        minOrderAmount: null,
      }),
    ).toEqual({ ok: false, message: 'This coupon does not apply to this plan.' });
  });
});
