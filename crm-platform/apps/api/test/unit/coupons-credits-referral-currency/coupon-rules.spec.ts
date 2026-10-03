import { describe, expect, it } from 'vitest';
import {
  decimalToScaled,
  majorDecimalToMinor,
  normaliseCouponInput,
  resolveCoupon,
  type CouponFacts,
  type ResolveContext,
} from '../../../src/modules/coupons-credits-referral-currency/coupon-rules';

const NOW = new Date('2026-06-15T12:00:00Z');

const coupon = (over: Partial<CouponFacts> = {}): CouponFacts => ({
  id: 1,
  code: 'WELCOME10',
  type: 'percent',
  amount: '10',
  maxDiscountAmount: null,
  currencyCode: null,
  minOrderAmount: null,
  maxUses: null,
  perUserLimit: null,
  usesCount: 0,
  applicablePlans: [],
  startsAt: null,
  expiresAt: null,
  isActive: true,
  firstPurchaseOnly: false,
  stackableWithOther: false,
  ...over,
});

const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({
  now: NOW,
  planSlug: 'pro',
  subtotalMinor: 100_00n,
  currency: 'USD',
  ...over,
});

const run = (c: CouponFacts | null, code = 'welcome10', x: Partial<ResolveContext> = {}) =>
  resolveCoupon(c, code, ctx(x));

describe('coupon resolver (TW-CPN-006)', () => {
  it('applies a percent coupon', () => {
    expect(run(coupon())).toEqual({ ok: true, message: 'Coupon applied.', discountMinor: 10_00n });
  });

  it('caps a percent discount at the maximum: 20% of 1000 capped at 50 is 50', () => {
    const r = run(coupon({ amount: '20', maxDiscountAmount: '50' }), 'x', {
      subtotalMinor: 1000_00n,
    });
    expect(r).toMatchObject({ ok: true, discountMinor: 50_00n });
  });

  it('ignores a zero cap (Reference: the cap applies only when above 0)', () => {
    const r = run(coupon({ amount: '20', maxDiscountAmount: '0' }), 'x', {
      subtotalMinor: 1000_00n,
    });
    expect(r).toMatchObject({ ok: true, discountMinor: 200_00n });
  });

  it('never discounts more than the order: fixed 500 on an order of 300 is 300', () => {
    const r = run(coupon({ type: 'fixed', amount: '500' }), 'x', { subtotalMinor: 300_00n });
    expect(r).toMatchObject({ ok: true, discountMinor: 300_00n });
  });

  it('caps a percent above 100 at the order', () => {
    expect(run(coupon({ amount: '150' }))).toMatchObject({ ok: true, discountMinor: 100_00n });
  });

  it('rounds half up in the order currency exponent', () => {
    // 12.5% of 0.84 = 0.105 -> 0.11 (half up)
    const r = run(coupon({ amount: '12.5' }), 'x', { subtotalMinor: 84n });
    expect(r).toMatchObject({ ok: true, discountMinor: 11n });
  });

  it('works in a zero-decimal currency (JPY) without float drift', () => {
    const r = run(coupon({ type: 'fixed', amount: '500' }), 'x', {
      currency: 'JPY',
      subtotalMinor: 1500n,
    });
    expect(r).toMatchObject({ ok: true, discountMinor: 500n });
  });

  it('works in a three-decimal currency (KWD)', () => {
    const r = run(coupon({ amount: '10' }), 'x', { currency: 'KWD', subtotalMinor: 12_500n });
    expect(r).toMatchObject({ ok: true, discountMinor: 1_250n });
  });

  it('resolves " welcome10 " the same as the stored code (trim, upper-case)', () => {
    expect(normaliseCouponInput(' welcome10 ')).toBe('WELCOME10');
    expect(run(coupon(), ' welcome10 ').ok).toBe(true);
  });

  describe('rejections, in the order a buyer meets them', () => {
    it('1 empty code', () => {
      expect(run(null, '   ')).toMatchObject({
        ok: false,
        reason: 'empty',
        message: 'Enter a coupon code.',
      });
    });
    it('2 unknown code', () => {
      expect(run(null, 'nope')).toMatchObject({
        ok: false,
        reason: 'not_found',
        message: 'Coupon "NOPE" not recognised.',
      });
    });
    it('3 disabled', () => {
      expect(run(coupon({ isActive: false }))).toMatchObject({
        reason: 'disabled',
        message: 'This coupon is disabled.',
      });
    });
    it('4 not started yet', () => {
      expect(run(coupon({ startsAt: new Date('2026-07-01T00:00:00Z') }))).toMatchObject({
        reason: 'not_started',
      });
    });
    it('5 expired (a past expiry); the instant of expiry itself still works', () => {
      expect(run(coupon({ expiresAt: new Date('2026-06-14T12:00:00Z') }))).toMatchObject({
        reason: 'expired',
        message: 'This coupon has expired.',
      });
      expect(run(coupon({ expiresAt: NOW })).ok).toBe(true);
    });
    it('6 fully used', () => {
      expect(run(coupon({ maxUses: 5, usesCount: 5 }))).toMatchObject({
        reason: 'exhausted',
        message: 'This coupon is fully used.',
      });
      expect(run(coupon({ maxUses: 5, usesCount: 4 })).ok).toBe(true);
    });
    it('7 currency lock: a coupon for INR refuses a USD order, and is skipped without an order currency', () => {
      const c = coupon({ currencyCode: 'inr' });
      expect(run(c, 'x', { currency: 'USD' })).toMatchObject({
        reason: 'currency_mismatch',
        message: 'This coupon is only valid for payments in INR.',
      });
      expect(run(c, 'x', { currency: 'INR' }).ok).toBe(true);
      expect(run(c, 'x', { currency: null }).ok).toBe(true);
    });
    it('8 stacking: refused when another, different code is already on the order', () => {
      expect(run(coupon(), 'x', { otherCodes: ['SAVE20'] })).toMatchObject({
        reason: 'not_stackable',
      });
      expect(run(coupon(), 'welcome10', { otherCodes: ['welcome10'] }).ok).toBe(true);
      expect(run(coupon({ stackableWithOther: true }), 'x', { otherCodes: ['SAVE20'] }).ok).toBe(
        true,
      );
    });
    it('9 first purchase only: refused after one paid order, accepted with none', () => {
      const c = coupon({ firstPurchaseOnly: true });
      expect(run(c, 'x', { buyer: { hasPaidOrder: true, paidOrdersWithCoupon: 0 } })).toMatchObject(
        {
          reason: 'first_purchase_only',
        },
      );
      expect(run(c, 'x', { buyer: { hasPaidOrder: false, paidOrdersWithCoupon: 0 } }).ok).toBe(
        true,
      );
      // no buyer known: the rule cannot be evaluated and is skipped, as in Reference
      expect(run(c, 'x').ok).toBe(true);
    });
    it('10 per-user limit: reached at the limit', () => {
      const c = coupon({ perUserLimit: 1 });
      expect(run(c, 'x', { buyer: { hasPaidOrder: true, paidOrdersWithCoupon: 1 } })).toMatchObject(
        {
          reason: 'per_user_limit',
        },
      );
      expect(run(c, 'x', { buyer: { hasPaidOrder: true, paidOrdersWithCoupon: 0 } }).ok).toBe(true);
    });
    it('11 below the minimum order, compared exactly', () => {
      const c = coupon({ minOrderAmount: '99.995' });
      expect(run(c, 'x', { subtotalMinor: 99_99n })).toMatchObject({
        reason: 'below_minimum',
        message: 'Order is below the coupon minimum.',
      });
      expect(run(coupon({ minOrderAmount: '100' }), 'x', { subtotalMinor: 100_00n }).ok).toBe(true);
    });
    it('12 plan restriction', () => {
      const c = coupon({ applicablePlans: ['starter', 'growth'] });
      expect(run(c, 'x', { planSlug: 'pro' })).toMatchObject({
        reason: 'plan_mismatch',
        message: 'This coupon does not apply to this plan.',
      });
      expect(run(c, 'x', { planSlug: 'growth' }).ok).toBe(true);
    });
    it('13 a coupon that yields nothing', () => {
      expect(run(coupon({ amount: '0' }))).toMatchObject({
        reason: 'no_discount',
        message: 'Coupon yielded no discount.',
      });
      expect(run(coupon(), 'x', { subtotalMinor: 0n })).toMatchObject({ reason: 'no_discount' });
    });
    it('checks in the documented order (disabled beats expired, expired beats currency)', () => {
      const c = coupon({
        isActive: false,
        expiresAt: new Date('2020-01-01T00:00:00Z'),
        currencyCode: 'INR',
      });
      expect(run(c)).toMatchObject({ reason: 'disabled' });
      expect(run({ ...c, isActive: true })).toMatchObject({ reason: 'expired' });
      expect(run({ ...c, isActive: true, expiresAt: null })).toMatchObject({
        reason: 'currency_mismatch',
      });
    });
  });

  describe('decimal helpers', () => {
    it('scales without float', () => {
      expect(decimalToScaled('12.5', 4)).toBe(125000n);
      expect(decimalToScaled('7', 4)).toBe(70000n);
      expect(majorDecimalToMinor('499.50', 'INR')).toBe(49950n);
      expect(majorDecimalToMinor('1500', 'JPY')).toBe(1500n);
      expect(majorDecimalToMinor('1.5', 'KWD')).toBe(1500n);
      expect(majorDecimalToMinor('0.005', 'USD')).toBe(1n);
    });
  });
});
