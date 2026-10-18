import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The message key (under `privacy-requests.errors`) for a failed call. Branch on `code`, never on the server's wording. */
export const ERROR_KEYS = [
  'network',
  'forbidden',
  'notFound',
  'subjectNotFound',
  'stateInvalid',
  'notVerified',
  'legalHold',
  'holdActive',
  'holdExists',
  'holdNotFound',
  'holdNotActive',
  'confirmationRequired',
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
    case ERROR_CODES.PRIVACY_REQUEST_NOT_FOUND:
    case ERROR_CODES.PRIVACY_EXPORT_NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.PRIVACY_SUBJECT_NOT_FOUND:
      return 'subjectNotFound';
    case ERROR_CODES.PRIVACY_REQUEST_STATE_INVALID:
      return 'stateInvalid';
    case ERROR_CODES.PRIVACY_IDENTITY_NOT_VERIFIED:
      return 'notVerified';
    case ERROR_CODES.PRIVACY_LEGAL_HOLD:
      return 'legalHold';
    case ERROR_CODES.LEGAL_HOLD_ACTIVE:
      return 'holdActive';
    case ERROR_CODES.LEGAL_HOLD_EXISTS:
      return 'holdExists';
    case ERROR_CODES.LEGAL_HOLD_NOT_FOUND:
      return 'holdNotFound';
    case ERROR_CODES.LEGAL_HOLD_NOT_ACTIVE:
      return 'holdNotActive';
    case ERROR_CODES.PRIVACY_CONFIRMATION_REQUIRED:
      return 'confirmationRequired';
    case ERROR_CODES.PRIVACY_EXPORT_IN_PROGRESS:
      return 'exportInProgress';
    case ERROR_CODES.PRIVACY_EXPORT_NOT_READY:
      return 'exportNotReady';
    case ERROR_CODES.VALIDATION_FAILED:
      return 'validation';
    default:
      break;
  }
  if (error.status === 429) return 'rateLimited';
  if (error.status === 404) return 'notFound';
  if (error.status === 409) return 'stateInvalid';
  return 'unexpected';
}
