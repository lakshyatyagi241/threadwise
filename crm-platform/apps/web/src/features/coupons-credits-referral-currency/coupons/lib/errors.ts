import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The message key (under `...coupons.errors`) for an API failure: chosen by the stable problem code, never by the wording. */
export const ERROR_KINDS = [
  'notFound',
  'conflict',
  'forbidden',
  'validation',
  'taken',
  'unknownPlan',
  'throttled',
  'network',
  'generic',
] as const;
export type CouponErrorKind = (typeof ERROR_KINDS)[number];

const BY_CODE: Record<string, CouponErrorKind> = {
  [ERROR_CODES.CPN_COUPON_CODE_TAKEN]: 'taken',
  [ERROR_CODES.CPN_COUPON_PLAN_UNKNOWN]: 'unknownPlan',
  [ERROR_CODES.CPN_COUPON_THROTTLED]: 'throttled',
  ROW_VERSION_CONFLICT: 'conflict',
  AUTH_OPERATOR_ROLE_REQUIRED: 'forbidden',
  VALIDATION_FAILED: 'validation',
  NOT_FOUND: 'notFound',
};

export function couponErrorKind(err: unknown): CouponErrorKind {
  if (!(err instanceof ApiError)) return 'network';
  const byCode = BY_CODE[err.code];
  if (byCode) return byCode;
  if (err.status === 404) return 'notFound';
  if (err.status === 403) return 'forbidden';
  return 'generic';
}

export const requestIdOf = (err: unknown): string | undefined =>
  err instanceof ApiError ? err.requestId : undefined;
