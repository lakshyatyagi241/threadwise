import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export type CpnErrorKey =
  | 'generic'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'validation'
  | 'codeTaken'
  | 'planUnknown'
  | 'slugTaken'
  | 'currencyUnknown'
  | 'currencyTaken'
  | 'defaultProtected'
  | 'inUse'
  | 'ratesFailed';

/** Which sentence a failed call gets. Branches on the stable `code` and status, never on the API's wording. */
export function cpnErrorKey(error: unknown): CpnErrorKey {
  if (!(error instanceof ApiError)) return 'generic';
  switch (error.code) {
    case ERROR_CODES.CPN_COUPON_CODE_TAKEN:
      return 'codeTaken';
    case ERROR_CODES.CPN_COUPON_PLAN_UNKNOWN:
      return 'planUnknown';
    case ERROR_CODES.CPN_PACKAGE_SLUG_TAKEN:
      return 'slugTaken';
    case ERROR_CODES.CPN_CURRENCY_UNKNOWN:
      return 'currencyUnknown';
    case ERROR_CODES.CPN_CURRENCY_CODE_TAKEN:
      return 'currencyTaken';
    case ERROR_CODES.CPN_CURRENCY_DEFAULT_PROTECTED:
      return 'defaultProtected';
    case ERROR_CODES.CPN_CURRENCY_IN_USE:
      return 'inUse';
    case ERROR_CODES.CPN_RATES_FETCH_FAILED:
      return 'ratesFailed';
  }
  if (error.isRowVersionConflict) return 'conflict';
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'notFound';
  if (error.status === 422) return 'validation';
  return 'generic';
}

/** The `usedBy` names a CPN_CURRENCY_IN_USE refusal carries ("plans", "orders"), for the sentence. */
export function usedByList(error: unknown): string {
  if (!(error instanceof ApiError)) return '';
  return error.fieldErrors
    .filter((e) => e.path === 'usedBy')
    .map((e) => e.message)
    .join(', ');
}
