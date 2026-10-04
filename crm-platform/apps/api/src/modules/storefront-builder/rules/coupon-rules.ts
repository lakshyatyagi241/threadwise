/** The columns of `wa_coupons` the shop's pricing needs. Money is minor units, `amount` is a percent for `percent`. */
export interface CouponTerms {
  code: string;
  type: string;
  amount: number;
  minSubtotalMinor: number | null;
  maxDiscountMinor: number | null;
  freeShipping: boolean;
  active: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
}

/** Usable right now for this subtotal (Reference `WaCoupon::redeemable`). Times are compared in server time. */
export function couponRedeemable(c: CouponTerms, subtotalMinor: number, now = new Date()): boolean {
  if (!c.active) return false;
  if (c.startsAt && c.startsAt.getTime() > now.getTime()) return false;
  if (c.expiresAt && c.expiresAt.getTime() < now.getTime()) return false;
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return false;
  if (c.minSubtotalMinor !== null && subtotalMinor < c.minSubtotalMinor) return false;
  return true;
}

/**
 * The discount in minor units (Reference `discountFor`): zero when not redeemable; `flat` is the amount; `percent` is the
 * subtotal times the percent (clamped 0..100) rounded, then capped by the maximum when one is set; never more than the subtotal.
 */
export function couponDiscount(c: CouponTerms, subtotalMinor: number, now = new Date()): number {
  if (!couponRedeemable(c, subtotalMinor, now)) return 0;
  let d: number;
  if (c.type === 'flat') {
    d = Math.trunc(c.amount);
  } else {
    d = Math.round((subtotalMinor * Math.min(100, Math.max(0, Math.trunc(c.amount)))) / 100);
    if (c.maxDiscountMinor !== null) d = Math.min(d, Math.trunc(c.maxDiscountMinor));
  }
  return Math.max(0, Math.min(d, subtotalMinor));
}
