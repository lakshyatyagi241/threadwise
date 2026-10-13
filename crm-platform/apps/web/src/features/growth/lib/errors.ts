import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The message key (under `growth.errors`) for a failed call. Branch on `code`, never on the server's wording. */
export const ERROR_KEYS = [
  'network',
  'forbidden',
  'notAvailable',
  'featureOff',
  'actionGone',
  'assistantFailed',
  'undoRefused',
  'conflict',
  'notFound',
  'validation',
  'rateLimited',
  'unexpected',
] as const;
export type ErrorKey = (typeof ERROR_KEYS)[number];

export function errorKey(error: unknown): ErrorKey {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.code) {
    case ERROR_CODES.GRW_NOT_AVAILABLE:
      return 'notAvailable';
    case ERROR_CODES.GRW_FEATURE_OFF:
      return 'featureOff';
    case ERROR_CODES.GRW_ACTION_GONE:
      return 'actionGone';
    case ERROR_CODES.GRW_ASSISTANT_FAILED:
      return 'assistantFailed';
    case ERROR_CODES.GRW_UNDO_REFUSED:
      return 'undoRefused';
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return 'conflict';
    case ERROR_CODES.NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.VALIDATION_FAILED:
      return 'validation';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
    default:
      if (error.status === 403 || error.code === ERROR_CODES.FORBIDDEN) return 'forbidden';
      return error.status === 404 ? 'notFound' : 'unexpected';
  }
}

export const isRowVersionConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ERROR_CODES.ROW_VERSION_CONFLICT;

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;
