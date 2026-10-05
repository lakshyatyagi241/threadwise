import { describe, expect, it } from 'vitest';
import {
  createStoreCouponSchema,
  listStoreOrdersQuerySchema,
  updateStoreOrderStatusSchema,
} from '@crm/contracts';
import {
  couponState,
  likePattern,
  normalizeCouponAmount,
  normalizeCouponCode,
  phoneDigits,
} from '../../../src/modules/storefront-builder/rules/coupon-admin';
import {
  couponDiscount,
  couponRedeemable,
} from '../../../src/modules/storefront-builder/rules/coupon-rules';
import {
  paymentLinkNotice,
  statusNotice,
} from '../../../src/modules/storefront-builder/rules/order-notice';
import {
  orderNoFromReference,
  orderReference,
  paymentMatchesOrder,
} from '../../../src/modules/storefront-builder/rules/order-reference';
import {
  canMoveOrder,
  isOrderStatus,
  planStatusUpdate,
} from '../../../src/modules/storefront-builder/rules/order-status';
import {
  buildPayments,
  buildTimeline,
  orderSubtotal,
  parseOrderLines,
} from '../../../src/modules/storefront-builder/rules/order-view';

const NOW = new Date('2026-10-05T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('order status (Reference updateStatus)', () => {
  it('knows the eight statuses', () => {
    for (const s of [
      'new',
      'pending',
      'confirmed',
      'paid',
      'processing',
      'completed',
      'shipped',
      'cancelled',
    ]) {
      expect(isOrderStatus(s)).toBe(true);
    }
    expect(isOrderStatus('refunded')).toBe(false);
    expect(isOrderStatus('')).toBe(false);
  });

  it('allows any status to any status, even out of cancelled (Reference has no state machine)', () => {
    expect(canMoveOrder('cancelled', 'new')).toBe(true);
    expect(canMoveOrder('completed', 'pending')).toBe(true);
    expect(canMoveOrder('new', 'new')).toBe(true);
    expect(canMoveOrder('new', 'refunded')).toBe(false);
    expect(canMoveOrder('weird', 'paid')).toBe(false);
  });

  it('messages the buyer when the status changed or a link was typed, and only with a phone', () => {
    expect(planStatusUpdate('new', 'confirmed', null, '919800000001').notifyBuyer).toBe(true);
    expect(planStatusUpdate('new', 'new', null, '919800000001').notifyBuyer).toBe(false);
    expect(
      planStatusUpdate('new', 'new', 'https://pay.example/x', '919800000001').notifyBuyer,
    ).toBe(true);
    expect(planStatusUpdate('new', 'new', '   ', '919800000001').notifyBuyer).toBe(false);
    expect(planStatusUpdate('new', 'confirmed', null, null).notifyBuyer).toBe(false);
    expect(planStatusUpdate('new', 'confirmed', null, '  ').notifyBuyer).toBe(false);
  });

  it('flags an invoice as due only on the move INTO paid or completed', () => {
    expect(planStatusUpdate('new', 'paid', null, null).invoiceDue).toBe(true);
    expect(planStatusUpdate('shipped', 'completed', null, null).invoiceDue).toBe(true);
    expect(planStatusUpdate('paid', 'paid', null, null).invoiceDue).toBe(false);
    expect(planStatusUpdate('new', 'shipped', null, null).invoiceDue).toBe(false);
  });

  it('the status form takes one of the eight statuses and a real link', () => {
    expect(updateStoreOrderStatusSchema.safeParse({ status: 'shipped' }).success).toBe(true);
    expect(updateStoreOrderStatusSchema.safeParse({ status: 'lost' }).success).toBe(false);
    expect(
      updateStoreOrderStatusSchema.safeParse({ status: 'paid', paymentLink: 'not a url' }).success,
    ).toBe(false);
    expect(
      updateStoreOrderStatusSchema.safeParse({ status: 'paid', notes: 'x'.repeat(1001) }).success,
    ).toBe(false);
  });
});

describe('buyer messages (Reference notifyBuyer, sendPaymentLink, generatePaymentLink)', () => {
  it('a status change reads "Your order #12 is now: Shipped"', () => {
    expect(
      statusNotice({
        orderNo: 12,
        status: 'shipped',
        statusChanged: true,
        link: null,
        totalMinor: 250000,
        currencyCode: 'INR',
      }),
    ).toBe('Your order #12 is now: Shipped');
  });

  it('a status change with a link carries both, separated by a blank line', () => {
    expect(
      statusNotice({
        orderNo: 12,
        status: 'pending',
        statusChanged: true,
        link: ' https://pay.example/x ',
        totalMinor: 250000,
        currencyCode: 'INR',
      }),
    ).toBe(
      "Your order #12 is now: Pending\n\nHere's your payment link for ₹ 2,500.00:\nhttps://pay.example/x",
    );
  });

  it('says nothing when nothing changed', () => {
    expect(
      statusNotice({
        orderNo: 1,
        status: 'new',
        statusChanged: false,
        link: ' ',
        totalMinor: 1,
        currencyCode: 'INR',
      }),
    ).toBeNull();
  });

  it('the pasted and the generated link read as Reference worded them', () => {
    const base = {
      customerName: 'Asha',
      totalMinor: 150000,
      currencyCode: 'USD',
      link: 'https://l/x',
    };
    expect(paymentLinkNotice({ ...base, generated: false })).toBe(
      "Hi Asha, here's your payment link for *$ 1,500.00*:\n\nhttps://l/x",
    );
    expect(paymentLinkNotice({ ...base, generated: true })).toBe(
      "Hi Asha, here's your secure payment link for *$ 1,500.00*:\n\nhttps://l/x",
    );
    expect(paymentLinkNotice({ ...base, customerName: null, generated: false })).toMatch(
      /^Hi there,/,
    );
  });
});

describe('order reference at the gateway', () => {
  it('round trips the order number', () => {
    expect(orderReference(42)).toBe('WAORD-42');
    expect(orderNoFromReference('WAORD-42')).toBe(42);
  });

  it('refuses anything that is not exactly ours', () => {
    for (const bad of [
      '',
      'WAORD-',
      'WAORD-0',
      'WAORD-1x',
      'INV-42',
      'xWAORD-42',
      'WAORD--4',
      'WAORD-99999999999999999999',
    ]) {
      expect(orderNoFromReference(bad), bad).toBeNull();
    }
  });

  it('a payment must match the order total and currency, or say nothing about either', () => {
    const order = { totalMinor: 5000, currencyCode: 'INR' };
    expect(paymentMatchesOrder(order, { amountMinor: 5000n, currency: 'inr' })).toBe(true);
    expect(paymentMatchesOrder(order, { amountMinor: 4999n })).toBe(false);
    expect(paymentMatchesOrder(order, { currency: 'USD' })).toBe(false);
    expect(paymentMatchesOrder(order, {})).toBe(true);
  });
});

describe('coupon rules for the admin screens', () => {
  const base = { active: true, startsAt: null, expiresAt: null, usageLimit: null, usedCount: 0 };

  it('stores the code upper case and trimmed', () => {
    expect(normalizeCouponCode('  save10 ')).toBe('SAVE10');
  });

  it('clamps a percentage to 0..100 and rounds money', () => {
    expect(normalizeCouponAmount('percent', 150)).toBe(100);
    expect(normalizeCouponAmount('percent', -5)).toBe(0);
    expect(normalizeCouponAmount('percent', 12.6)).toBe(13);
    expect(normalizeCouponAmount('flat', 10050.4)).toBe(10050);
  });

  it('derives where a coupon stands: off, not started, expired, used up, active', () => {
    expect(couponState({ ...base, active: false }, NOW)).toBe('inactive');
    expect(couponState({ ...base, startsAt: day(1) }, NOW)).toBe('scheduled');
    expect(couponState({ ...base, expiresAt: day(-1) }, NOW)).toBe('expired');
    expect(couponState({ ...base, usageLimit: 3, usedCount: 3 }, NOW)).toBe('exhausted');
    expect(couponState({ ...base, usageLimit: 3, usedCount: 2, expiresAt: day(2) }, NOW)).toBe(
      'active',
    );
    // Off wins over everything else.
    expect(couponState({ ...base, active: false, expiresAt: day(-1) }, NOW)).toBe('inactive');
  });

  it('agrees with what the checkout will redeem (the minimum spend aside)', () => {
    const terms = {
      code: 'X',
      type: 'percent',
      amount: 10,
      minSubtotalMinor: null,
      maxDiscountMinor: null,
      freeShipping: false,
      ...base,
    };
    for (const c of [
      { ...terms, active: false },
      { ...terms, startsAt: day(1) },
      { ...terms, expiresAt: day(-1) },
      { ...terms, usageLimit: 1, usedCount: 1 },
      terms,
    ]) {
      expect(couponRedeemable(c, 10000, NOW)).toBe(couponState(c, NOW) === 'active');
    }
    expect(couponDiscount({ ...terms, maxDiscountMinor: 500 }, 10000, NOW)).toBe(500);
  });

  it('the create form refuses a bad code, a window that ends before it starts, and a negative amount', () => {
    const ok = { code: 'SAVE-10', type: 'percent', amount: 10 };
    expect(createStoreCouponSchema.safeParse(ok).success).toBe(true);
    expect(createStoreCouponSchema.safeParse({ ...ok, code: 'has space' }).success).toBe(false);
    expect(createStoreCouponSchema.safeParse({ ...ok, code: 'a'.repeat(65) }).success).toBe(false);
    expect(createStoreCouponSchema.safeParse({ ...ok, amount: -1 }).success).toBe(false);
    expect(createStoreCouponSchema.safeParse({ ...ok, usageLimit: 0 }).success).toBe(false);
    expect(
      createStoreCouponSchema.safeParse({
        ...ok,
        startsAt: '2026-10-10T00:00:00Z',
        expiresAt: '2026-10-09T00:00:00Z',
      }).success,
    ).toBe(false);
    // Reference clamps a percentage over 100 instead of refusing it.
    expect(createStoreCouponSchema.safeParse({ ...ok, amount: 150 }).success).toBe(true);
  });

  it('a search term is literal: wildcards are escaped', () => {
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%');
    expect(likePattern('a\\b')).toBe('%a\\\\b%');
  });

  it('reduces a phone to digits', () => {
    expect(phoneDigits('+91 98000-00001')).toBe('919800000001');
    expect(phoneDigits('abc')).toBeNull();
    expect(phoneDigits(null)).toBeNull();
  });
});

describe('order list filters', () => {
  it('defaults to every status and source, 25 a page', () => {
    const q = listStoreOrdersQuerySchema.parse({});
    expect(q).toMatchObject({ status: 'all', source: 'all', limit: 25 });
  });

  it('refuses an unknown status, a malformed day and a page over 100', () => {
    expect(listStoreOrdersQuerySchema.safeParse({ status: 'lost' }).success).toBe(false);
    expect(listStoreOrdersQuerySchema.safeParse({ from: '05/10/2026' }).success).toBe(false);
    expect(listStoreOrdersQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(
      listStoreOrdersQuerySchema.safeParse({ paymentStatus: 'paid', from: '2026-10-01' }).success,
    ).toBe(true);
  });
});

describe('how an order is shown', () => {
  it('reads the lines the checkout writes and the aliases other channels use', () => {
    const lines = parseOrderLines([
      {
        product_id: 5,
        name: 'Kurta',
        qty: 2,
        price_minor: 49900,
        image: 'https://i/k.png',
        retailer_id: 'SKU1',
      },
      { title: 'Mug', quantity: 1, priceMinor: 20000 },
      { name: '', qty: 0 },
    ]);
    expect(lines[0]).toEqual({
      productId: 5,
      name: 'Kurta',
      qty: 2,
      priceMinor: 49900,
      lineTotalMinor: 99800,
      image: 'https://i/k.png',
      retailerId: 'SKU1',
    });
    expect(lines[1]).toMatchObject({ name: 'Mug', qty: 1, lineTotalMinor: 20000, productId: null });
    expect(lines[2]).toMatchObject({ name: 'Item', qty: 1 });
    expect(parseOrderLines(null)).toEqual([]);
  });

  it('the subtotal is the lines, else the total with shipping and exclusive tax taken out', () => {
    const lines = parseOrderLines([{ name: 'A', qty: 2, price_minor: 1000 }]);
    const o = {
      totalMinor: 2500,
      shippingMinor: 500,
      taxMinor: 0,
      taxInclusive: false,
      discountMinor: 0,
    };
    expect(orderSubtotal(lines, o)).toBe(2000);
    expect(orderSubtotal([], { ...o, discountMinor: 200, taxMinor: 100 })).toBe(
      2500 - 500 - 100 + 200,
    );
    expect(orderSubtotal([], { ...o, taxInclusive: true, taxMinor: 100 })).toBe(2000);
  });

  const facts = {
    totalMinor: 5000,
    currencyCode: 'INR',
    paymentMethod: 'prepaid',
    waPaymentStatus: null,
    waPaymentTxnId: null,
    paidAt: new Date('2026-10-05T10:00:00Z'),
  };

  it('a link that was issued and not paid is awaiting', () => {
    const p = buildPayments({
      ...facts,
      paymentStatus: 'awaiting',
      paymentLink: 'https://rzp/l',
      meta: { gateway_slug: 'razorpay', payment_link_id: 'plink_1' },
    });
    expect(p).toEqual([
      {
        kind: 'payment_link',
        gateway: 'razorpay',
        status: 'awaiting',
        reference: 'plink_1',
        url: 'https://rzp/l',
        at: null,
        amountMinor: 5000,
        currencyCode: 'INR',
      },
    ]);
  });

  it('a Razorpay link paid by webhook shows the payment id and the time', () => {
    const [p] = buildPayments({
      ...facts,
      paymentStatus: 'paid',
      paymentLink: 'https://rzp/l',
      meta: { paid_via: 'razorpay_link', razorpay_payment: 'pay_9', razorpay_plink: 'plink_1' },
    });
    expect(p).toMatchObject({
      kind: 'payment_link',
      status: 'paid',
      gateway: 'razorpay',
      reference: 'pay_9',
      at: '2026-10-05T10:00:00.000Z',
    });
  });

  it('another gateway adds its settlement record', () => {
    const p = buildPayments({
      ...facts,
      paymentStatus: 'paid',
      paymentLink: 'https://stripe/pay',
      meta: { paid_via: 'stripe', gateway_slug: 'stripe', gateway_payment_id: 'pi_1' },
    });
    expect(p.map((x) => x.kind)).toEqual(['payment_link', 'gateway']);
    expect(p[1]).toMatchObject({ gateway: 'stripe', status: 'paid', reference: 'pi_1' });
  });

  it('cash on delivery and a hand-marked paid status are their own records', () => {
    expect(
      buildPayments({
        ...facts,
        paymentMethod: 'cod',
        paymentStatus: 'cod',
        paymentLink: null,
        meta: null,
      })[0],
    ).toMatchObject({ kind: 'cod', status: 'cod' });
    expect(
      buildPayments({ ...facts, paymentStatus: 'paid', paymentLink: null, meta: null })[0],
    ).toMatchObject({ kind: 'manual', status: 'paid' });
  });

  it('the timeline starts with how it was placed and follows the audit trail', () => {
    const t = buildTimeline({ source: 'storefront', createdAt: new Date('2026-10-05T09:00:00Z') }, [
      {
        at: new Date('2026-10-05T11:00:00Z'),
        actorType: 'system',
        action: 'update',
        delta: { status: { old: 'new', new: 'paid' } },
      },
      {
        at: new Date('2026-10-05T10:00:00Z'),
        actorType: 'user',
        action: 'update',
        delta: { status: { old: 'new', new: 'confirmed' }, notes: { old: false, new: true } },
      },
      {
        at: new Date('2026-10-05T10:30:00Z'),
        actorType: 'user',
        action: 'update',
        delta: { paymentLink: { old: false, new: true } },
      },
    ]);
    expect(t.map((e) => [e.kind, e.actor, e.detail])).toEqual([
      ['created', 'customer', 'Placed via storefront'],
      ['status_changed', 'user', 'new → confirmed'],
      ['note', 'user', null],
      ['payment_link', 'user', 'Payment link issued'],
      ['paid', 'system', 'new → paid'],
    ]);
  });
});
