import { majorToMinor } from './order-pricing';

/**
 * Coupon rules (WD-PAYGW-010), ported from WaDesk's `Coupon::resolve` and done in integer minor units. The coupons domain (CPN)
 * owns coupons; until it exposes its service through its barrel this module evaluates the rules against the `coupons` row itself
 * (see CouponService). The messages are WaDesk's, word for word, because the buyer reads them.
 */

export interface CouponFacts {
  id: number;
  code: string;
  type: string;
  /** numeric(12,4): a percentage for `percent`, an amount in the order's currency for `fixed`. */
  amount: string;
  currencyCode: string | null;
  maxDiscountAmount: string | null;
  minOrderAmount: string | null;
  maxUses: number | null;
  perUserLimit: number | null;
  usesCount: number;
  /** jsonb list of plan references. Slugs match; WaDesk's numeric package ids cannot be resolved here and never match. */
  applicable: unknown;
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
  firstPurchaseOnly: boolean;
}

export interface CouponContext {
  planSlug: string | null;
  /** The price before the coupon, in the order currency (what the buyer sees as subtotal). */
  subtotalMinor: bigint;
  currency: string;
  now: Date;
  /** What the buyer has already paid for, from the orders ledger. Null when the buyer is unknown. */
  buyer: { paidOrders: number; usedThisCoupon: number } | null;
}

export type CouponVerdict =
  { ok: true; message: string; discountMinor: bigint } | { ok: false; message: string };

const reject = (message: string): CouponVerdict => ({ ok: false, message });

/** "20.0000" -> 200000n (ten-thousandths); anything else -> null. */
function tenThousandths(v: string): bigint | null {
  const m = /^(\d{1,12})(?:\.(\d{1,4}))?\d*$/.exec(v.trim());
  return m ? BigInt(m[1]! + (m[2] ?? '').padEnd(4, '0')) : null;
}

const halfUp = (n: bigint, d: bigint): bigint => (n * 2n + d) / (d * 2n);

export function evaluateCoupon(c: CouponFacts, x: CouponContext): CouponVerdict {
  if (!c.isActive) return reject('This coupon is disabled.');
  if (c.startsAt && c.startsAt.getTime() > x.now.getTime())
    return reject('This coupon is not active yet.');
  if (c.expiresAt && c.expiresAt.getTime() < x.now.getTime())
    return reject('This coupon has expired.');
  if (c.maxUses !== null && c.usesCount >= c.maxUses) return reject('This coupon is fully used.');
  // The currency lock is checked against the ORDER currency here and at placement alike (WaDesk previewed in one currency and bound in another).
  if (c.currencyCode && c.currencyCode.toUpperCase() !== x.currency.toUpperCase()) {
    return reject(`This coupon is only valid for payments in ${c.currencyCode.toUpperCase()}.`);
  }
  if (x.buyer) {
    if (c.firstPurchaseOnly && x.buyer.paidOrders > 0) {
      return reject('This coupon is valid on your first purchase only.');
    }
    if (c.perUserLimit !== null && c.perUserLimit > 0 && x.buyer.usedThisCoupon >= c.perUserLimit) {
      return reject('You have already used this coupon the maximum number of times.');
    }
  }
  if (c.minOrderAmount !== null) {
    const min = majorToMinor(c.minOrderAmount, x.currency);
    if (min !== null && x.subtotalMinor < min) return reject('Order is below the coupon minimum.');
  }
  if (Array.isArray(c.applicable) && c.applicable.length > 0) {
    const slugs = c.applicable
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.toLowerCase());
    if (!x.planSlug || !slugs.includes(x.planSlug.toLowerCase())) {
      return reject('This coupon does not apply to this plan.');
    }
  }

  const amt = tenThousandths(c.amount);
  if (amt === null) return reject('Coupon yielded no discount.');
  let discount: bigint;
  if (c.type === 'percent') {
    discount = halfUp(x.subtotalMinor * amt, 1_000_000n);
    const cap = c.maxDiscountAmount === null ? null : majorToMinor(c.maxDiscountAmount, x.currency);
    if (cap !== null && cap > 0n && discount > cap) discount = cap;
  } else {
    discount = majorToMinor(c.amount, x.currency) ?? 0n;
  }
  if (discount > x.subtotalMinor) discount = x.subtotalMinor; // never discount more than the order
  if (discount <= 0n) return reject('Coupon yielded no discount.');
  return { ok: true, message: 'Coupon applied.', discountMinor: discount };
}
