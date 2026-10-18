import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The message key (under `persona-vocabulary.errors`) for a failed call. Branch on `code`, never on the server's wording. */
export type ErrorKey =
  'network' | 'forbidden' | 'conflict' | 'validation' | 'rateLimited' | 'unexpected';

export const ERROR_KEYS: readonly ErrorKey[] = [
  'network',
  'forbidden',
  'conflict',
  'validation',
  'rateLimited',
  'unexpected',
];

export function errorKey(error: unknown): ErrorKey {
  if (!(error instanceof ApiError)) return 'network';
  if (error.status === 403 || error.code === ERROR_CODES.FORBIDDEN) return 'forbidden';
  if (error.code === ERROR_CODES.ROW_VERSION_CONFLICT || error.status === 409) return 'conflict';
  if (error.code === ERROR_CODES.VALIDATION_FAILED || error.status === 422) return 'validation';
  if (error.status === 429) return 'rateLimited';
  return 'unexpected';
}

export const isRowVersionConflict = (e: unknown): boolean =>
  e instanceof ApiError && e.isRowVersionConflict;
