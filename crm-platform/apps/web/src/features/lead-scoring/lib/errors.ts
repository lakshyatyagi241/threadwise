import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The message key (under `lead-scoring.errors`) for a failed call. Branch on `code`, never on the server's wording. */
export type ErrorKey =
  | 'network'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'platformDisabled'
  | 'notEnabled'
  | 'noKey'
  | 'providerFailed'
  | 'manualScore'
  | 'planLimit'
  | 'rateLimited'
  | 'validation'
  | 'unexpected';

export const ERROR_KEYS: readonly ErrorKey[] = [
  'network',
  'forbidden',
  'notFound',
  'conflict',
  'platformDisabled',
  'notEnabled',
  'noKey',
  'providerFailed',
  'manualScore',
  'planLimit',
  'rateLimited',
  'validation',
  'unexpected',
];

export function errorKey(error: unknown): ErrorKey {
  if (!(error instanceof ApiError)) return 'network';
  if (error.status === 403 || error.code === ERROR_CODES.FORBIDDEN) return 'forbidden';
  switch (error.code) {
    case ERROR_CODES.LSC_PLATFORM_DISABLED:
      return 'platformDisabled';
    case ERROR_CODES.LSC_NOT_ENABLED:
      return 'notEnabled';
    case ERROR_CODES.LSC_NO_KEY:
      return 'noKey';
    case ERROR_CODES.LSC_PROVIDER_FAILED:
      return 'providerFailed';
    case ERROR_CODES.LSC_MANUAL_SCORE:
      return 'manualScore';
    case ERROR_CODES.PLAN_LIMIT_REACHED:
      return 'planLimit';
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return 'conflict';
    case ERROR_CODES.NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.VALIDATION_FAILED:
      return 'validation';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
    default:
      return error.status === 404 ? 'notFound' : 'unexpected';
  }
}

export const isRowVersionConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ERROR_CODES.ROW_VERSION_CONFLICT;

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;
