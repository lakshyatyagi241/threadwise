import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEED,
  DEMO_COMPANY_PREFIX,
  DEMO_COUPON_CODES,
  DEMO_SHIPPING,
  buildDemoPlan,
  demoPhones,
  rng,
  summarisePlan,
  tileImage,
} from '../../../src/modules/storefront-builder/cli/demo-plan';
import { couponDiscount } from '../../../src/modules/storefront-builder/rules/coupon-rules';
import { shippingFee } from '../../../src/modules/storefront-builder/rules/shipping';

const NOW = new Date('2026-10-05T10:00:00.000Z');
const DAY = 86_400_000;
const EXISTING = [
  { name: 'Demo Contact 2', phone: '+919876500002', email: 'demo2@Admin.test' },
  { name: 'Demo Contact 3', phone: '+919876500003', email: null },
  { name: 'Demo Contact 4', phone: '+919876500004', email: null },
  { name: 'Demo Contact 5', phone: '+919876500005', email: null },
];
const plan = () => buildDemoPlan({ now: NOW, existingContacts: EXISTING });

describe('the store demo plan: determinism', () => {
  it('the same seed and clock give the same plan, byte for byte', () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });

  it('a different seed gives a different plan, a different clock only moves the dates', () => {
    const base = plan();
    const other = buildDemoPlan({ now: NOW, existingContacts: EXISTING, seed: DEFAULT_SEED + 1 });
    expect(JSON.stringify(other.orders)).not.toBe(JSON.stringify(base.orders));
    const later = buildDemoPlan({
      now: new Date(NOW.getTime() + 3600_000),
      existingContacts: EXISTING,
    });
    const strip = (p: typeof base) => p.orders.map((o) => JSON.stringify({ ...o, placedAt: 0 }));
    // coupon eligibility reads the order date, so compare only what the clock cannot change
    const shape = (p: typeof base) =>
      p.orders.map((o) => `${o.key}|${o.customerKey}|${o.status}|${o.payState}|${o.lines.length}`);
    expect(shape(later)).toEqual(shape(base));
    expect(strip(later)).toHaveLength(30);
  });

  it('the generator is stable across calls (no hidden state between runs)', () => {
    const a = rng(7);
    const b = rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    plan();
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });

  it('every row has a stable unique key and a number block that no real subscriber owns', () => {
    const p = plan();
    expect(new Set(p.orders.map((o) => o.key)).size).toBe(p.orders.length);
    expect(p.orders.map((o) => o.key)[0]).toBe('demo-order-01');
    expect(new Set(p.products.map((x) => x.slug)).size).toBe(p.products.length);
    expect(p.products.every((x) => x.slug.startsWith('demo-'))).toBe(true);
    expect(new Set(p.customers.map((c) => c.phone)).size).toBe(p.customers.length);
    expect(demoPhones()).toHaveLength(10);
    expect(p.coupons.map((c) => c.code)).toEqual([...DEMO_COUPON_CODES]);
  });
});

describe('the store demo plan: what it covers', () => {
  it('has 12 products in 3 categories, 5 coupons, 14 customers and 30 orders', () => {
    const s = summarisePlan(plan());
    expect(s).toMatchObject({ products: 12, categories: 3, coupons: 5, customers: 14, orders: 30 });
    expect(s.existingContactCustomers).toBe(4);
    expect(s.repeatCustomers).toBeGreaterThanOrEqual(2);
  });

  it('covers every status, both sources and every payment state', () => {
    const s = summarisePlan(plan());
    for (const status of [
      'new',
      'pending',
      'confirmed',
      'paid',
      'processing',
      'completed',
      'shipped',
      'cancelled',
    ]) {
      expect(s.byStatus[status], status).toBeGreaterThan(0);
    }
    expect(s.bySource.storefront).toBeGreaterThan(0);
    expect(s.bySource.waba).toBeGreaterThan(0);
    for (const state of ['paid', 'unpaid', 'refunded', 'awaiting', 'cod']) {
      expect(s.byPayState[state], state).toBeGreaterThan(0);
    }
  });

  it('places the orders inside the last 45 days, oldest first, never in the future', () => {
    const p = plan();
    const times = p.orders.map((o) => o.placedAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(NOW.getTime() - 45 * DAY);
    expect(Math.max(...times)).toBeLessThanOrEqual(NOW.getTime());
    expect(NOW.getTime() - Math.min(...times)).toBeGreaterThan(30 * DAY);
  });

  it('uses gateways on paid orders only, a payment id for each, and a payment link only while awaiting', () => {
    const p = plan();
    for (const o of p.orders) {
      const paid = o.payState === 'paid' || o.payState === 'refunded';
      expect(o.gateway !== null, o.key).toBe(paid);
      expect(o.gatewayPaymentId !== null, o.key).toBe(paid);
      expect(o.paymentLink !== null, o.key).toBe(o.payState === 'awaiting');
      if (o.payState === 'refunded') expect(o.status).toBe('cancelled');
      if (o.payState === 'paid') expect(['paid', 'completed']).toContain(o.status);
    }
    const ids = p.orders.map((o) => o.gatewayPaymentId).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has shipping, tax and discount lines, and every total adds up', () => {
    const p = plan();
    expect(p.orders.some((o) => o.shippingMinor > 0)).toBe(true);
    expect(p.orders.some((o) => o.taxMinor > 0 && o.taxRatePercent === 18)).toBe(true);
    expect(p.orders.some((o) => o.discountMinor > 0 && o.couponCode)).toBe(true);
    for (const o of p.orders) {
      const lines = o.lines.reduce((a, l) => a + l.unitMinor * l.qty, 0);
      expect(o.subtotalMinor, o.key).toBe(lines);
      expect(o.totalMinor, o.key).toBe(
        o.subtotalMinor - o.discountMinor + o.shippingMinor + o.taxMinor,
      );
      expect(Number.isInteger(o.totalMinor)).toBe(true);
      expect(o.lines.length).toBeGreaterThanOrEqual(1);
      if (o.taxRatePercent) {
        expect(o.taxMinor).toBe(
          Math.round(((o.subtotalMinor - o.discountMinor) * o.taxRatePercent) / 100),
        );
      }
    }
  });

  it('applies the shop rule for shipping and the coupon rules for discounts', () => {
    const p = plan();
    for (const o of p.orders) {
      const coupon = p.coupons.find((c) => c.code === o.couponCode);
      if (o.source === 'storefront' && !coupon?.freeShipping) {
        expect(o.shippingMinor, o.key).toBe(shippingFee(DEMO_SHIPPING, o.subtotalMinor));
      }
      if (coupon) {
        const terms = { ...coupon, active: true, usageLimit: null, usedCount: 0 };
        expect(o.discountMinor, o.key).toBe(couponDiscount(terms, o.subtotalMinor, o.placedAt));
        expect(o.source).toBe('storefront');
      } else {
        expect(o.discountMinor).toBe(0);
      }
    }
  });

  it('has the five coupons the screens need: percent, flat, expired, used up and store-scoped', () => {
    const p = plan();
    const by = (code: string) => p.coupons.find((c) => c.code === code)!;
    expect(by('DEMO-WELCOME10').type).toBe('percent');
    expect(by('DEMO-FLAT200').type).toBe('flat');
    expect(by('DEMO-EXPIRED15').expiresAt!.getTime()).toBeLessThan(NOW.getTime());
    const soldOut = by('DEMO-SOLDOUT20');
    expect(soldOut.usedCount).toBe(soldOut.usageLimit);
    expect(soldOut.usedCount).toBeGreaterThan(0);
    expect(by('DEMO-STORE5').storeScoped).toBe(true);
    for (const c of p.coupons) {
      expect(c.usedCount, c.code).toBe(p.orders.filter((o) => o.couponCode === c.code).length);
    }
    // the expired coupon was used while it was still valid
    for (const o of p.orders.filter((x) => x.couponCode === 'DEMO-EXPIRED15')) {
      expect(o.placedAt.getTime()).toBeLessThanOrEqual(by('DEMO-EXPIRED15').expiresAt!.getTime());
    }
  });

  it('customers: existing contacts keep their own number, new ones sit in the seed number block, all are labelled demo', () => {
    const p = plan();
    expect(p.customers.filter((c) => c.existingContact).map((c) => c.phone)).toEqual(
      EXISTING.map((c) => c.phone),
    );
    const block = new Set(demoPhones());
    for (const c of p.customers.filter((x) => !x.existingContact)) {
      expect(block.has(c.phone)).toBe(true);
    }
    expect(p.customers.every((c) => c.company.startsWith(DEMO_COMPANY_PREFIX))).toBe(true);
    // two customers have a saved profile and no order
    const ordering = new Set(p.orders.map((o) => o.customerKey));
    expect(p.customers.filter((c) => !ordering.has(c.key))).toHaveLength(2);
  });

  it('with no existing contacts every customer is new', () => {
    const p = buildDemoPlan({ now: NOW });
    expect(p.customers).toHaveLength(10);
    expect(p.orders).toHaveLength(30);
  });

  it('products: prices, stock left (a sold-out one, a low one, a draft) and self-contained images', () => {
    const p = plan();
    expect(p.products.some((x) => x.stockQty === 0)).toBe(true);
    expect(p.products.some((x) => x.stockQty !== null && x.stockQty > 0 && x.stockQty <= 5)).toBe(
      true,
    );
    expect(p.products.filter((x) => x.status === 'draft')).toHaveLength(1);
    for (const x of p.products) {
      expect(x.priceMinor).toBeGreaterThan(0);
      expect(x.image.startsWith('data:image/svg+xml')).toBe(true);
      expect(x.image).not.toMatch(/https?:\/\//);
    }
    expect(decodeURIComponent(tileImage('Zip Hoodie', 40))).toContain('ZH');
    // a draft product is never ordered
    const draft = p.products.find((x) => x.status === 'draft')!;
    expect(p.orders.some((o) => o.lines.some((l) => l.productKey === draft.key))).toBe(false);
  });
});
