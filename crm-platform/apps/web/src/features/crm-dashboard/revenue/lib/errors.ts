import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The message key (under `crm-revenue.errors`) for a failed call. Branch on `code`, never on the server's wording. */
export const ERROR_KEYS = [
  'network',
  'forbidden',
  'notFound',
  'exportInProgress',
  'exportNotReady',
  'rateLimited',
  'validation',
  'unexpected',
] as const;
export type ErrorKey = (typeof ERROR_KEYS)[number];

export function errorKey(error: unknown): ErrorKey {
  if (!(error instanceof ApiError)) return 'network';
  if (error.status === 403 || error.code === ERROR_CODES.FORBIDDEN) return 'forbidden';
  switch (error.code) {
    case ERROR_CODES.REVENUE_EXPORT_NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.REVENUE_EXPORT_IN_PROGRESS:
      return 'exportInProgress';
    case ERROR_CODES.REVENUE_EXPORT_NOT_READY:
      return 'exportNotReady';
    case ERROR_CODES.VALIDATION_FAILED:
      return 'validation';
    default:
      break;
  }
  if (error.status === 429) return 'rateLimited';
  if (error.status === 404) return 'notFound';
  return 'unexpected';
}
