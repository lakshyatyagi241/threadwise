import { ERROR_CODES, type ApplyCouponResponse, type PaygwQuote } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The order summary the buyer sees: the quote, or (with a coupon applied) the summary the server computed for the code. */
export interface SummaryView {
  subtotal: string;
  discount: string | null;
  couponCode: string | null;
  tax: string;
  total: string;
}

/**
 * The browser never recomputes tax or totals: with a coupon applied the figures are the server's `apply` response, otherwise
 * the quote's. An applied coupon that belongs to another currency is ignored (the card clears it on any change, this is the guard).
 */
export function summaryView(
  q: Pick<PaygwQuote, 'subtotal' | 'tax' | 'total' | 'currency'>,
  applied: ApplyCouponResponse | null,
): SummaryView {
  if (applied?.ok && applied.code && applied.currency === q.currency) {
    return {
      subtotal: applied.subtotal,
      discount: applied.discount,
      couponCode: applied.code,
      tax: applied.tax,
      total: applied.total,
    };
  }
  return { subtotal: q.subtotal, discount: null, couponCode: null, tax: q.tax, total: q.total };
}

export type CouponCheck =
  { kind: 'applied'; response: ApplyCouponResponse } | { kind: 'rejected'; message: string };

/** `ok:false` messages are user-facing text from the server and are shown as they are. */
export function interpretApply(res: ApplyCouponResponse): CouponCheck {
  return res.ok && res.code
    ? { kind: 'applied', response: res }
    : { kind: 'rejected', message: res.message };
}

export type CouponFailure = 'throttled' | 'network';
export const couponFailureOf = (e: unknown): CouponFailure =>
  e instanceof ApiError && e.code === ERROR_CODES.CPN_COUPON_THROTTLED ? 'throttled' : 'network';

/** A 422 with this code means the order was NOT created because the coupon was refused: show its text, drop the discount. */
export const isCouponRejected = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.code === ERROR_CODES.CPN_COUPON_REJECTED;
