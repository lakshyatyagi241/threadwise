import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export const ERROR_KINDS = [
  'isDefault',
  'inUse',
  'notActive',
  'codeTaken',
  'ratesFailed',
  'conflict',
  'validation',
  'forbidden',
  'network',
  'generic',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

const BY_CODE: Record<string, ErrorKind> = {
  [ERROR_CODES.CPN_CURRENCY_IS_DEFAULT]: 'isDefault',
  [ERROR_CODES.CPN_CURRENCY_IN_USE]: 'inUse',
  [ERROR_CODES.CPN_CURRENCY_NOT_ACTIVE]: 'notActive',
  [ERROR_CODES.CPN_CURRENCY_CODE_TAKEN]: 'codeTaken',
  [ERROR_CODES.CPN_RATES_FETCH_FAILED]: 'ratesFailed',
  ROW_VERSION_CONFLICT: 'conflict',
  VALIDATION_FAILED: 'validation',
};

/** The message kind for an API failure: chosen by the stable `code`, never by the wording. */
export function errorKind(err: unknown): ErrorKind {
  if (!(err instanceof ApiError)) return 'network';
  return BY_CODE[err.code] ?? (err.status === 403 ? 'forbidden' : 'generic');
}

/** What still uses a currency the API refused to delete ("workspaces", "plans"...), from the problem's field errors. */
export function inUseBy(err: unknown): string[] {
  if (!(err instanceof ApiError)) return [];
  return err.fieldErrors.filter((e) => e.path === 'currency').map((e) => e.message);
}

/** The provider's own explanation for a failed rate fetch: the problem `detail`, which is the error's message. */
export const ratesFailureDetail = (err: unknown): string =>
  err instanceof ApiError ? err.message : '';

export const requestIdOf = (err: unknown): string | undefined =>
  err instanceof ApiError ? err.requestId : undefined;
