import { describe, expect, it } from 'vitest';
import type { StorefrontProduct } from '../../../src/modules/catalog-products';
import {
  couponDiscount,
  couponRedeemable,
  type CouponTerms,
} from '../../../src/modules/storefront-builder/rules/coupon-rules';
import {
  computeTotals,
  mergeRequested,
  priceLines,
} from '../../../src/modules/storefront-builder/rules/pricing';
import {
  buildShippingJson,
  majorToMinor,
  minorToMajorString,
  shippingFee,
} from '../../../src/modules/storefront-builder/rules/shipping';

const product = (
  over: Partial<StorefrontProduct> & { uuid: string; id: number },
): StorefrontProduct => ({
  slug: `p-${over.id}`,
  sku: null,
  name: `Product ${over.id}`,
  description: null,
  bodyHtml: null,
  priceMinor: 100_00,
  comparePriceMinor: null,
  currencyCode: 'INR',
  imageUrl: null,
  galleryUrls: [],
  category: null,
  brand: null,
  stockQty: null,
  metaRetailerId: null,
  ...over,
});

const coupon = (over: Partial<CouponTerms> = {}): CouponTerms => ({
  code: 'SAVE',
  type: 'percent',
  amount: 10,
  minSubtotalMinor: null,
  maxDiscountMinor: null,
  freeShipping: false,
  active: true,
  startsAt: null,
  expiresAt: null,
  usageLimit: null,
  usedCount: 0,
  ...over,
});

describe('shipping (TW-STORE-006, 013)', () => {
  it('flat 49.50 and free above 999 save as 4950 and 99900 and charge accordingly', () => {
    const cfg = buildShippingJson({ flat: '49.50', freeAbove: '999', note: null });
    expect(cfg).toEqual({ flat_minor: 4950, free_above_minor: 99900 });
    expect(shippingFee(cfg, 99899)).toBe(4950);
    expect(shippingFee(cfg, 99900)).toBe(0);
    expect(shippingFee(cfg, 120000)).toBe(0);
  });

  it('all inputs blank clear shipping and checkout charges 0', () => {
    expect(buildShippingJson({ flat: '', freeAbove: null, note: '' })).toBeNull();
    expect(buildShippingJson({ flat: '0', freeAbove: '0.00', note: null })).toBeNull();
    expect(shippingFee(null, 50_000)).toBe(0);
  });

  it('the note alone is kept and amounts round as PHP does', () => {
    expect(buildShippingJson({ flat: null, freeAbove: null, note: '2-5 days' })).toEqual({
      note: '2-5 days',
    });
    expect(majorToMinor('1.005')).toBe(100);
    expect(majorToMinor('19.99')).toBe(1999);
  });

  it('minor units come back as the decimal the form shows', () => {
    expect(minorToMajorString(4950)).toBe('49.50');
    expect(minorToMajorString(10000)).toBe('100');
    expect(minorToMajorString(undefined)).toBeNull();
  });
});

describe('coupons (TW-STORE-014)', () => {
  it('a 20 percent coupon capped at 50.00 on a 400.00 cart gives 50.00', () => {
    const c = coupon({ amount: 20, maxDiscountMinor: 50_00 });
    expect(couponDiscount(c, 400_00)).toBe(50_00);
    expect(
      computeTotals({ subtotalMinor: 400_00, shipping: { flat_minor: 30_00 }, coupon: c })
        .totalMinor,
    ).toBe(350_00 + 30_00);
  });

  it('a flat coupon larger than the subtotal discounts the subtotal and leaves only shipping', () => {
    const c = coupon({ type: 'flat', amount: 900_00 });
    const t = computeTotals({ subtotalMinor: 400_00, shipping: { flat_minor: 30_00 }, coupon: c });
    expect(t.discountMinor).toBe(400_00);
    expect(t.totalMinor).toBe(30_00);
  });

  it('a 300.00 cart under a 500.00 minimum is not redeemable', () => {
    const c = coupon({ minSubtotalMinor: 500_00 });
    expect(couponRedeemable(c, 300_00)).toBe(false);
    expect(couponDiscount(c, 300_00)).toBe(0);
    expect(couponRedeemable(c, 500_00)).toBe(true);
  });

  it('expired, not yet started, inactive and used-up coupons are not redeemable', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    expect(
      couponRedeemable(coupon({ expiresAt: new Date('2026-10-01T00:00:00Z') }), 100, now),
    ).toBe(false);
    expect(couponRedeemable(coupon({ startsAt: new Date('2026-10-03T00:00:00Z') }), 100, now)).toBe(
      false,
    );
    expect(couponRedeemable(coupon({ active: false }), 100, now)).toBe(false);
    expect(couponRedeemable(coupon({ usageLimit: 5, usedCount: 5 }), 100, now)).toBe(false);
    expect(couponRedeemable(coupon({ usageLimit: 5, usedCount: 4 }), 100, now)).toBe(true);
  });

  it('a free-shipping coupon waives a flat fee and reports free shipping', () => {
    const t = computeTotals({
      subtotalMinor: 200_00,
      shipping: { flat_minor: 50_00 },
      coupon: coupon({ freeShipping: true, amount: 0 }),
    });
    expect(t.freeShipping).toBe(true);
    expect(t.shippingMinor).toBe(0);
    expect(t.discountMinor).toBe(0);
    expect(t.couponValid).toBe(true);
  });

  it('a valid coupon worth nothing is still valid (discount 0, no free shipping)', () => {
    const t = computeTotals({
      subtotalMinor: 200_00,
      shipping: null,
      coupon: coupon({ amount: 0 }),
    });
    expect(t.couponValid).toBe(true);
    expect(t.discountMinor).toBe(0);
  });

  it('an expired free-shipping coupon does not waive shipping (Reference bug fixed)', () => {
    const t = computeTotals({
      subtotalMinor: 200_00,
      shipping: { flat_minor: 50_00 },
      coupon: coupon({ freeShipping: true, expiresAt: new Date('2020-01-01') }),
    });
    expect(t.freeShipping).toBe(false);
    expect(t.shippingMinor).toBe(50_00);
  });

  it('shipping is decided on the subtotal before the discount', () => {
    // 1100 qualifies for free shipping above 1000 even though the 20 percent discount brings the payable below it.
    const t = computeTotals({
      subtotalMinor: 1100_00,
      shipping: { flat_minor: 30_00, free_above_minor: 1000_00 },
      coupon: coupon({ amount: 20 }),
    });
    expect(t.shippingMinor).toBe(0);
    expect(t.totalMinor).toBe(880_00);
  });
});

describe('cart re-pricing (TW-STORE-013)', () => {
  const a = product({ id: 1, uuid: 'a', priceMinor: 100_00, stockQty: 5 });
  const b = product({ id: 2, uuid: 'b', priceMinor: 50_00, stockQty: null });
  const map = new Map([
    ['a', a],
    ['b', b],
  ]);

  it('duplicate lines add up', () => {
    expect([
      ...mergeRequested([
        { id: 'a', qty: 1 },
        { id: 'a', qty: 2 },
        { id: 'b', qty: 1 },
      ]),
    ]).toEqual([
      ['a', 3],
      ['b', 1],
    ]);
  });

  it('A x2 (100.00, stock 5) and B x1 (50.00) with shipping 30 free above 1000 total 28000 minor', () => {
    const { lines, subtotalMinor } = priceLines(
      map,
      mergeRequested([
        { id: 'a', qty: 2 },
        { id: 'b', qty: 1 },
      ]),
    );
    expect(subtotalMinor).toBe(25000);
    const t = computeTotals({
      subtotalMinor,
      shipping: { flat_minor: 3000, free_above_minor: 100000 },
      coupon: null,
    });
    expect(t.shippingMinor).toBe(3000);
    expect(t.totalMinor).toBe(28000);
    expect(lines.map((l) => l.qty)).toEqual([2, 1]);
  });

  it('a quantity above the stock is clamped to the stock; unlimited stock never is', () => {
    const { lines } = priceLines(
      map,
      mergeRequested([
        { id: 'a', qty: 9 },
        { id: 'b', qty: 500 },
      ]),
    );
    expect(lines.map((l) => [l.product.uuid, l.qty, l.requested])).toEqual([
      ['a', 5, 9],
      ['b', 500, 500],
    ]);
  });

  it('unknown, unavailable and sold-out products are dropped; nothing left means no lines', () => {
    const soldOut = product({ id: 3, uuid: 'c', stockQty: 0 });
    const r = priceLines(
      new Map([['c', soldOut]]),
      mergeRequested([
        { id: 'c', qty: 1 },
        { id: 'ghost', qty: 1 },
      ]),
    );
    expect(r.lines).toEqual([]);
    expect(r.subtotalMinor).toBe(0);
  });

  it('prices come from the product, so a client price cannot be injected', () => {
    // The request type has no price field at all: the subtotal can only be the product's.
    const { subtotalMinor } = priceLines(
      map,
      mergeRequested([{ id: 'a', qty: 1, price: 1 } as never]),
    );
    expect(subtotalMinor).toBe(100_00);
  });
});
