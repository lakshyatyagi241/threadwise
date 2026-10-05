import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** What the person is told about a failed call, chosen by error `code`, never by the server's wording. */
export const ERROR_KINDS = [
  'network',
  'forbidden',
  'signedOut',
  'conflict',
  'validation',
  'unavailable',
  'rateLimited',
  'notFound',
  'planLocked',
  'couponCodeTaken',
  'groupCodeTaken',
  'orderNoPhone',
  'gatewayNotConfigured',
  'gatewayUnavailable',
  'paymentLinkFailed',
  'unexpected',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.code) {
    case ERROR_CODES.FORBIDDEN:
      return 'forbidden';
    case ERROR_CODES.UNAUTHENTICATED:
      return 'signedOut';
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return 'conflict';
    case ERROR_CODES.VALIDATION_FAILED:
      return 'validation';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
    case ERROR_CODES.NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.PLAN_FEATURE_LOCKED:
      return 'planLocked';
    case ERROR_CODES.STORE_COUPON_CODE_TAKEN:
      return 'couponCodeTaken';
    case ERROR_CODES.STORE_GROUP_CODE_TAKEN:
      return 'groupCodeTaken';
    case ERROR_CODES.STORE_ORDER_NO_PHONE:
      return 'orderNoPhone';
    case ERROR_CODES.STORE_GATEWAY_NOT_CONFIGURED:
      return 'gatewayNotConfigured';
    case ERROR_CODES.STORE_GATEWAY_UNAVAILABLE:
      return 'gatewayUnavailable';
    case ERROR_CODES.STORE_PAYMENT_LINK_FAILED:
      return 'paymentLinkFailed';
  }
  // A route that is not deployed answers 404 or 501 without one of our codes for it.
  if (error.status === 404 || error.status === 501) return 'unavailable';
  return 'unexpected';
}

/** The server's per-field messages by field name. The first message of a field wins. */
export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(error instanceof ApiError)) return out;
  for (const f of error.fieldErrors) {
    const key = f.path.replace(/^body\./, '');
    if (!(key in out)) out[key] = f.message;
  }
  return out;
}

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;
