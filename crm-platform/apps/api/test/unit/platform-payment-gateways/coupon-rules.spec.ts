import { describe, expect, it } from 'vitest';
import {
  evaluateCoupon,
  type CouponContext,
  type CouponFacts,
} from '../../../src/modules/platform-payment-gateways/coupon-rules';

/**
 * Coupon rules at checkout (TW-PAYGW-010, QA task 5). Integer minor units, so a rupee amount is hundredths. Expected discounts are worked
 * out by hand; the refusal messages are the buyer-facing sentences from Reference.
 */
const NOW = new Date('2026-10-14T12:00:00Z');
const coupon = (over: Partial<CouponFacts> = {}): CouponFacts => ({
  id: 1,
  code: 'SAVE',
  type: 'percent',
  amount: '20.0000',
  currencyCode: null,
  maxDiscountAmount: null,
  minOrderAmount: null,
  maxUses: null,
  perUserLimit: null,
  usesCount: 0,
  applicable: null,
  startsAt: null,
  expiresAt: null,
  isActive: true,
  firstPurchaseOnly: false,
  ...over,
});
const ctx = (over: Partial<CouponContext> = {}): CouponContext => ({
  planSlug: 'pro',
  subtotalMinor: 100_000n, // Rs 1,000.00
  currency: 'INR',
  now: NOW,
  buyer: { paidOrders: 0, usedThisCoupon: 0 },
  ...over,
});
const refused = (c: CouponFacts, x: CouponContext = ctx()) => {
  const v = evaluateCoupon(c, x);
  return v.ok ? 'ACCEPTED' : v.message;
};
const discount = (c: CouponFacts, x: CouponContext = ctx()) => {
  const v = evaluateCoupon(c, x);
  if (!v.ok) throw new Error(`refused: ${v.message}`);
  return v.discountMinor;
};

describe('how much is taken off', () => {
  it('a percentage of the subtotal', () => {
    expect(discount(coupon({ amount: '20.0000' }))).toBe(20_000n);
    expect(discount(coupon({ amount: '100' }))).toBe(100_000n);
    expect(discount(coupon({ amount: '0.5' }))).toBe(500n);
  });
  it('rounds a percentage half up', () => {
    // 12.5% of 333 = 41.625 -> 42; 12.5% of 332 = 41.5 -> 42; 12.5% of 331 = 41.375 -> 41
    expect(discount(coupon({ amount: '12.5' }), ctx({ subtotalMinor: 333n }))).toBe(42n);
    expect(discount(coupon({ amount: '12.5' }), ctx({ subtotalMinor: 332n }))).toBe(42n);
    expect(discount(coupon({ amount: '12.5' }), ctx({ subtotalMinor: 331n }))).toBe(41n);
  });
  it('a percentage is capped by the maximum discount, when there is one', () => {
    expect(discount(coupon({ maxDiscountAmount: '150.00' }))).toBe(15_000n);
    expect(discount(coupon({ maxDiscountAmount: '500.00' }))).toBe(20_000n); // the cap is higher than the discount: no effect
    expect(discount(coupon({ maxDiscountAmount: '0' }))).toBe(20_000n); // a cap of zero means no cap
  });
  it('a fixed amount is in the order currency', () => {
    expect(discount(coupon({ type: 'fixed', amount: '250.00' }))).toBe(25_000n);
    expect(
      discount(
        coupon({ type: 'fixed', amount: '250' }),
        ctx({ currency: 'JPY', subtotalMinor: 10_000n }),
      ),
    ).toBe(250n);
  });
  it('never takes off more than the order costs', () => {
    expect(discount(coupon({ type: 'fixed', amount: '5000.00' }))).toBe(100_000n);
    expect(discount(coupon({ amount: '100' }), ctx({ subtotalMinor: 777n }))).toBe(777n);
  });
  it('a discount of nothing is refused', () => {
    expect(refused(coupon({ amount: '0' }))).toBe('Coupon yielded no discount.');
    expect(refused(coupon({ amount: 'abc' }))).toBe('Coupon yielded no discount.');
    expect(refused(coupon({ amount: '20' }), ctx({ subtotalMinor: 0n }))).toBe(
      'Coupon yielded no discount.',
    );
    expect(refused(coupon({ type: 'fixed', amount: '-5' }))).toBe('Coupon yielded no discount.');
  });
  it('says "Coupon applied." with the amount', () => {
    expect(evaluateCoupon(coupon(), ctx())).toEqual({
      ok: true,
      message: 'Coupon applied.',
      discountMinor: 20_000n,
    });
  });
});

describe('when a coupon is refused', () => {
  it.each([
    ['disabled', { isActive: false }, 'This coupon is disabled.'],
    [
      'not started',
      { startsAt: new Date('2026-10-14T12:00:01Z') },
      'This coupon is not active yet.',
    ],
    ['expired', { expiresAt: new Date('2026-10-14T11:59:59Z') }, 'This coupon has expired.'],
    ['fully used', { maxUses: 10, usesCount: 10 }, 'This coupon is fully used.'],
    ['over used', { maxUses: 10, usesCount: 11 }, 'This coupon is fully used.'],
    [
      'the wrong currency',
      { currencyCode: 'usd' },
      'This coupon is only valid for payments in USD.',
    ],
    ['below the minimum', { minOrderAmount: '1000.01' }, 'Order is below the coupon minimum.'],
    ['another plan', { applicable: ['basic'] }, 'This coupon does not apply to this plan.'],
  ] as const)('%s', (_name, over, message) => {
    expect(refused(coupon(over as Partial<CouponFacts>))).toBe(message);
  });

  it.each([
    ['starts exactly now', { startsAt: NOW }],
    ['expires exactly now', { expiresAt: NOW }],
    ['one use left', { maxUses: 10, usesCount: 9 }],
    ['unlimited uses', { maxUses: null, usesCount: 9999 }],
    ['the same currency in another letter case', { currencyCode: 'inr' }],
    ['exactly the minimum', { minOrderAmount: '1000.00' }],
    ['a plan list that names this plan in another letter case', { applicable: ['PRO'] }],
    ['an empty plan list (no restriction)', { applicable: [] }],
  ] as const)('is accepted when it %s', (_name, over) => {
    expect(refused(coupon(over as Partial<CouponFacts>))).toBe('ACCEPTED');
  });

  it('a plan list of Reference package ids (numbers) can never match, and neither can an order with no plan', () => {
    expect(refused(coupon({ applicable: [3, 7] }))).toBe(
      'This coupon does not apply to this plan.',
    );
    expect(refused(coupon({ applicable: ['pro'] }), ctx({ planSlug: null }))).toBe(
      'This coupon does not apply to this plan.',
    );
  });
  it('a minimum that cannot be read is ignored rather than blocking the buyer', () => {
    expect(refused(coupon({ minOrderAmount: 'lots' }))).toBe('ACCEPTED');
  });

  describe('the buyer', () => {
    it('first purchase only: refused once they have paid for anything', () => {
      expect(
        refused(
          coupon({ firstPurchaseOnly: true }),
          ctx({ buyer: { paidOrders: 1, usedThisCoupon: 0 } }),
        ),
      ).toBe('This coupon is valid on your first purchase only.');
      expect(
        refused(
          coupon({ firstPurchaseOnly: true }),
          ctx({ buyer: { paidOrders: 0, usedThisCoupon: 0 } }),
        ),
      ).toBe('ACCEPTED');
    });
    it('per-user limit: refused at the limit, and a limit of zero means unlimited', () => {
      const limited = coupon({ perUserLimit: 2 });
      expect(refused(limited, ctx({ buyer: { paidOrders: 3, usedThisCoupon: 1 } }))).toBe(
        'ACCEPTED',
      );
      expect(refused(limited, ctx({ buyer: { paidOrders: 3, usedThisCoupon: 2 } }))).toBe(
        'You have already used this coupon the maximum number of times.',
      );
      expect(
        refused(coupon({ perUserLimit: 0 }), ctx({ buyer: { paidOrders: 3, usedThisCoupon: 50 } })),
      ).toBe('ACCEPTED');
    });
    it('an unknown buyer is not held to the buyer rules (the preview before sign-in)', () => {
      expect(
        refused(coupon({ firstPurchaseOnly: true, perUserLimit: 1 }), ctx({ buyer: null })),
      ).toBe('ACCEPTED');
    });
  });

  it('checks the cheap reasons first: disabled wins over expired, expired over fully used', () => {
    const both = {
      isActive: false,
      expiresAt: new Date('2020-01-01T00:00:00Z'),
      maxUses: 1,
      usesCount: 1,
    };
    expect(refused(coupon(both))).toBe('This coupon is disabled.');
    expect(refused(coupon({ ...both, isActive: true }))).toBe('This coupon has expired.');
    expect(refused(coupon({ ...both, isActive: true, expiresAt: null }))).toBe(
      'This coupon is fully used.',
    );
  });
});
