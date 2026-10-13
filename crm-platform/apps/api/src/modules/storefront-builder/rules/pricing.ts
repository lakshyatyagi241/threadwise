import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { StorefrontProduct, StorefrontVariant } from '../../catalog-products';
import { couponDiscount, couponRedeemable, type CouponTerms } from './coupon-rules';
import { shippingFee, type ShippingConfig } from './shipping';

/** One cart line as the buyer sent it: the product, the chosen variant (variants products only), and the quantity. */
export interface RequestedLine {
  productUuid: string;
  variantUuid: string | null;
  qty: number;
}

/**
 * The cart as the buyer sent it, merged by product and variant (duplicates add up; the same product in two variants stays two
 * lines). Only ids and quantities are read from the client: every price comes from the database.
 */
export function mergeRequested(
  items: ReadonlyArray<{ id: string; variantId?: string | undefined; qty: number }>,
): Map<string, RequestedLine> {
  const out = new Map<string, RequestedLine>();
  for (const row of items) {
    const qty = Math.max(1, Math.trunc(row.qty) || 1);
    const variantUuid = row.variantId ?? null;
    const key = `${row.id}:${variantUuid ?? ''}`;
    const line = out.get(key);
    if (line) line.qty += qty;
    else out.set(key, { productUuid: row.id, variantUuid, qty });
  }
  return out;
}

export interface PricedLine {
  product: StorefrontProduct;
  /** The chosen variant of a product with variants; absent for a plain product. */
  variant?: StorefrontVariant;
  /** What one unit costs: the variant's effective price, else the product's. */
  unitPriceMinor: number;
  /** After the stock clamp. */
  qty: number;
  /** What the buyer asked for, summed over duplicate lines (the stock taken is this, never below zero). */
  requested: number;
}

/** The identity of a line for ordering and merging: product, then variant. */
export const lineKey = (l: Pick<PricedLine, 'product' | 'variant'>): string =>
  `${l.product.id}:${l.variant?.id ?? 0}`;

/** Lock order of stock rows: product id, then variant id. */
export const compareLines = (
  a: Pick<PricedLine, 'product' | 'variant'>,
  b: Pick<PricedLine, 'product' | 'variant'>,
): number => a.product.id - b.product.id || (a.variant?.id ?? 0) - (b.variant?.id ?? 0);

/**
 * Re-prices the cart from the products the database says are available (Reference `priceItems`). A product that vanished or sold
 * out is dropped; a tracked quantity is clamped to the stock; a line clamped to nothing is dropped; an unlimited product
 * (`stockQty` null) is never clamped. Lines keep the order the buyer sent them in.
 *
 * A product with variants is bought as (product, variant): the price is the variant's, the stock is the variant's, and a variant
 * that is gone or inactive drops its line like a vanished product. A line for such a product WITHOUT a variant is rejected
 * (422 STORE_ITEMS_UNAVAILABLE): silently dropping it would charge the buyer for a different cart. A variant sent for a plain
 * product is ignored.
 */
export function priceLines(
  products: ReadonlyMap<string, StorefrontProduct>,
  requested: ReadonlyMap<string, RequestedLine>,
): { lines: PricedLine[]; subtotalMinor: number } {
  const merged = new Map<string, PricedLine>();
  for (const want of requested.values()) {
    const product = products.get(want.productUuid);
    if (!product) continue;
    let variant: StorefrontVariant | undefined;
    if (product.variants && product.variants.length > 0) {
      if (!want.variantUuid) throw itemsUnavailable();
      variant = product.variants.find((v) => v.uuid === want.variantUuid);
      if (!variant) continue;
    }
    const key = lineKey({ product, variant });
    const prior = merged.get(key);
    if (prior) {
      prior.requested += want.qty;
      continue;
    }
    merged.set(key, {
      product,
      ...(variant ? { variant } : {}),
      unitPriceMinor: variant ? variant.priceMinor : product.priceMinor,
      qty: 0,
      requested: want.qty,
    });
  }
  const lines: PricedLine[] = [];
  let subtotalMinor = 0;
  for (const line of merged.values()) {
    const stock = line.variant ? line.variant.stockQty : line.product.stockQty;
    const qty = stock === null ? line.requested : Math.min(line.requested, Math.max(0, stock));
    if (qty < 1) continue;
    subtotalMinor += line.unitPriceMinor * qty;
    lines.push({ ...line, qty });
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

const itemsUnavailable = () =>
  new AppError(
    ERROR_CODES.STORE_ITEMS_UNAVAILABLE,
    'Those items are no longer available. Please refresh and try again.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
