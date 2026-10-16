import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The message key (under `compliance-center.errors`) for a failed call. Branch on `code`, never on the server's wording. */
export const ERROR_KEYS = [
  'network',
  'forbidden',
  'notFound',
  'conflict',
  'settingsInvalid',
  'duplicate',
  'dncInvalid',
  'rateLimited',
  'validation',
  'unexpected',
] as const;
export type ErrorKey = (typeof ERROR_KEYS)[number];

export function errorKey(error: unknown): ErrorKey {
  if (!(error instanceof ApiError)) return 'network';
  if (error.status === 403 || error.code === ERROR_CODES.FORBIDDEN) return 'forbidden';
  switch (error.code) {
    case ERROR_CODES.COMPLIANCE_SETTINGS_INVALID:
      return 'settingsInvalid';
    case ERROR_CODES.COMPLIANCE_SUBPROCESSOR_NOT_FOUND:
    case ERROR_CODES.COMPLIANCE_DNC_NOT_FOUND:
    case ERROR_CODES.COMPLIANCE_TRUST_PAGE_NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.COMPLIANCE_SUBPROCESSOR_DUPLICATE:
      return 'duplicate';
    case ERROR_CODES.COMPLIANCE_DNC_INVALID:
      return 'dncInvalid';
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return 'conflict';
    case ERROR_CODES.VALIDATION_FAILED:
      return 'validation';
    default:
      break;
  }
  if (error.status === 429) return 'rateLimited';
  if (error.status === 404) return 'notFound';
  if (error.status === 409) return 'conflict';
  return 'unexpected';
}

export const isRowVersionConflict = (e: unknown): boolean =>
  e instanceof ApiError && e.isRowVersionConflict;
