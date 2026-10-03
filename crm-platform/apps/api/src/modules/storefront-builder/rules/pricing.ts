import type { StorefrontProduct } from '../../catalog-products';
import { couponDiscount, couponRedeemable, type CouponTerms } from './coupon-rules';
import { shippingFee, type ShippingConfig } from './shipping';

/**
 * The cart as the buyer sent it, merged by product (duplicates add up). Only ids and quantities are read from the client:
 * every price comes from the database.
 */
export function mergeRequested(
  items: ReadonlyArray<{ id: string; qty: number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of items) {
    const qty = Math.max(1, Math.trunc(row.qty) || 1);
    out.set(row.id, (out.get(row.id) ?? 0) + qty);
  }
  return out;
}

export interface PricedLine {
  product: StorefrontProduct;
  /** After the stock clamp. */
  qty: number;
  /** What the buyer asked for, summed over duplicate lines (the stock taken is this, never below zero). */
  requested: number;
}

/**
 * Re-prices the cart from the products the database says are available (Reference `priceItems`). A product that vanished or sold
 * out is dropped; a tracked quantity is clamped to the stock; a line clamped to nothing is dropped; an unlimited product
 * (`stockQty` null) is never clamped. Lines keep the order the buyer sent them in.
 */
export function priceLines(
  products: ReadonlyMap<string, StorefrontProduct>,
  requested: ReadonlyMap<string, number>,
): { lines: PricedLine[]; subtotalMinor: number } {
  const lines: PricedLine[] = [];
  let subtotalMinor = 0;
  for (const [uuid, want] of requested) {
    const product = products.get(uuid);
    if (!product) continue;
    const qty = product.stockQty === null ? want : Math.min(want, Math.max(0, product.stockQty));
    if (qty < 1) continue;
    subtotalMinor += product.priceMinor * qty;
    lines.push({ product, qty, requested: want });
  }
  return { lines, subtotalMinor };
}

export interface Totals {
  discountMinor: number;
  shippingMinor: number;
  totalMinor: number;
  /** The coupon is usable for this cart. */
  couponValid: boolean;
  /** The coupon is valid and waives shipping. */
  freeShipping: boolean;
}

/**
 * Discount, shipping and total of a cart. Shipping is decided on the subtotal before the discount; a redeemable free-shipping
 * coupon zeroes it; the total is `max(0, subtotal - discount) + shipping` and there is no tax.
 */
export function computeTotals(input: {
  subtotalMinor: number;
  shipping: ShippingConfig | null;
  coupon: CouponTerms | null;
  now?: Date;
}): Totals {
  const now = input.now ?? new Date();
  const couponValid = input.coupon
    ? couponRedeemable(input.coupon, input.subtotalMinor, now)
    : false;
  const discountMinor = input.coupon ? couponDiscount(input.coupon, input.subtotalMinor, now) : 0;
  const freeShipping = couponValid && input.coupon!.freeShipping;
  const shippingMinor = freeShipping ? 0 : shippingFee(input.shipping, input.subtotalMinor);
  return {
    discountMinor,
    shippingMinor,
    totalMinor: Math.max(0, input.subtotalMinor - discountMinor) + shippingMinor,
    couponValid,
    freeShipping,
  };
}
