import { COUPON_APPLIED_MESSAGE, couponRejectionMessage, currencyExponent } from '@crm/contracts';
import type { CouponRejectionReason } from '@crm/contracts';

/**
 * The coupon resolver (WD-CPN-006): one pure function that decides whether a code applies to an order and how much it takes off.
 * WaDesk did this in floats rounded to two decimals; here every amount is an integer count of minor units in the ORDER currency,
 * so a zero-decimal or three-decimal currency comes out right and nothing drifts. Rounding is half up, like PHP's round().
 *
 * The order of the checks is the contract: it decides which sentence a buyer sees first (inventory WD-CPN-006).
 */

export interface CouponFacts {
  id: number;
  code: string;
  type: 'percent' | 'fixed';
  /** Percent (0-100+) or currency units, a decimal string with up to four decimals. */
  amount: string;
  maxDiscountAmount: string | null;
  currencyCode: string | null;
  minOrderAmount: string | null;
  maxUses: number | null;
  perUserLimit: number | null;
  usesCount: number;
  /** Plan or add-on slugs; empty = any plan. */
  applicablePlans: readonly string[];
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
  firstPurchaseOnly: boolean;
  stackableWithOther: boolean;
}

/** What the buyer's history says; the caller fetches it only when the coupon has a rule that needs it. */
export interface BuyerFacts {
  /** The buyer has at least one order that was paid (any kind: plan, add-on, wallet top-up). */
  hasPaidOrder: boolean;
  /** Paid orders of this buyer that redeemed THIS coupon. */
  paidOrdersWithCoupon: number;
}

export interface ResolveContext {
  now: Date;
  planSlug: string;
  /** The authoritative price before tax, in minor units of `currency`. */
  subtotalMinor: bigint;
  currency: string | null;
  /** Other codes already on the order, for the stacking rule. */
  otherCodes?: readonly string[];
  buyer?: BuyerFacts | null;
}

export type Resolution =
  | { ok: true; message: string; discountMinor: bigint }
  | { ok: false; reason: CouponRejectionReason; message: string };

const reject = (
  reason: CouponRejectionReason,
  ctx: { code?: string; currency?: string | null } = {},
): Resolution => ({ ok: false, reason, message: couponRejectionMessage(reason, ctx) });

/** What the buyer typed, normalised the way WaDesk did: trimmed and upper-cased. */
export const normaliseCouponInput = (raw: string): string => raw.trim().toUpperCase();

/** "12.5" -> 125000n at scale 4 (digits after the point beyond `scale` are cut; callers pass at most four). */
export function decimalToScaled(value: string, scale: number): bigint {
  const [whole = '0', frac = ''] = value.trim().split('.');
  return BigInt(whole + frac.padEnd(scale, '0').slice(0, scale));
}

/** Half-up integer division for non-negative operands. */
const divRound = (n: bigint, d: bigint): bigint => (n * 2n + d) / (d * 2n);

/** A major-unit decimal string as minor units of `currency`, rounded half up ("12.345" in USD is 1235). */
export function majorDecimalToMinor(value: string, currency: string): bigint {
  const exp = currencyExponent(currency);
  const scaled = decimalToScaled(value, 4);
  // scaled is major * 10^4; minor = major * 10^exp.
  return exp >= 4 ? scaled * 10n ** BigInt(exp - 4) : divRound(scaled, 10n ** BigInt(4 - exp));
}

export function resolveCoupon(
  coupon: CouponFacts | null,
  rawCode: string,
  ctx: ResolveContext,
): Resolution {
  const code = normaliseCouponInput(rawCode);
  if (code === '') return reject('empty');
  if (!coupon) return reject('not_found', { code });
  if (!coupon.isActive) return reject('disabled');

  const now = ctx.now.getTime();
  if (coupon.startsAt && coupon.startsAt.getTime() > now) return reject('not_started');
  if (coupon.expiresAt && coupon.expiresAt.getTime() < now) return reject('expired');
  if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) return reject('exhausted');

  // Currency lock: only when the order currency is known (WaDesk skipped it without one).
  if (
    coupon.currencyCode &&
    ctx.currency &&
    coupon.currencyCode.toUpperCase() !== ctx.currency.toUpperCase()
  ) {
    return reject('currency_mismatch', { currency: coupon.currencyCode });
  }

  // Stacking: refused only for a coupon that is not stackable when a DIFFERENT code is already on the order.
  if (!coupon.stackableWithOther) {
    const others = (ctx.otherCodes ?? [])
      .map(normaliseCouponInput)
      .filter((c) => c !== '' && c !== code);
    if (others.length > 0) return reject('not_stackable');
  }

  // Per-buyer rules need a known buyer (WaDesk skipped them without one).
  if (ctx.buyer) {
    if (coupon.firstPurchaseOnly && ctx.buyer.hasPaidOrder) return reject('first_purchase_only');
    if (
      coupon.perUserLimit !== null &&
      coupon.perUserLimit > 0 &&
      ctx.buyer.paidOrdersWithCoupon >= coupon.perUserLimit
    ) {
      return reject('per_user_limit');
    }
  }

  const exp = currencyExponent(ctx.currency ?? coupon.currencyCode ?? 'USD');
  if (coupon.minOrderAmount !== null) {
    // Exact comparison at four decimals: the subtotal in minor units against the minimum in major units.
    const subtotal4 = ctx.subtotalMinor * 10n ** BigInt(Math.max(0, 4 - exp));
    const min4 = decimalToScaled(coupon.minOrderAmount, 4);
    if (exp <= 4 && subtotal4 < min4) return reject('below_minimum');
  }
  if (coupon.applicablePlans.length > 0 && !coupon.applicablePlans.includes(ctx.planSlug)) {
    return reject('plan_mismatch');
  }

  const currency = ctx.currency ?? coupon.currencyCode ?? 'USD';
  let discount: bigint;
  if (coupon.type === 'percent') {
    // amount is percent with up to four decimals: discount = subtotal * pct / 100.
    discount = divRound(ctx.subtotalMinor * decimalToScaled(coupon.amount, 4), 1_000_000n);
    if (coupon.maxDiscountAmount !== null) {
      const cap = majorDecimalToMinor(coupon.maxDiscountAmount, currency);
      if (cap > 0n && discount > cap) discount = cap;
    }
  } else {
    discount = majorDecimalToMinor(coupon.amount, currency);
  }
  if (discount > ctx.subtotalMinor) discount = ctx.subtotalMinor; // never discount more than the order
  if (discount <= 0n) return reject('no_discount');

  return { ok: true, message: COUPON_APPLIED_MESSAGE, discountMinor: discount };
}
