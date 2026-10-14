import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The message key (under `contact-consent.errors`) for a failed call. Branch on `code`, never on the server's wording. */
export type ErrorKey =
  | 'network'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'noteRequired'
  | 'noticeTargetMissing'
  | 'settingsInvalid'
  | 'exportInProgress'
  | 'exportNotReady'
  | 'rateLimited'
  | 'validation'
  | 'unexpected';

export const ERROR_KEYS: readonly ErrorKey[] = [
  'network',
  'forbidden',
  'notFound',
  'conflict',
  'noteRequired',
  'noticeTargetMissing',
  'settingsInvalid',
  'exportInProgress',
  'exportNotReady',
  'rateLimited',
  'validation',
  'unexpected',
];

export function errorKey(error: unknown): ErrorKey {
  if (!(error instanceof ApiError)) return 'network';
  if (error.status === 403 || error.code === ERROR_CODES.FORBIDDEN) return 'forbidden';
  switch (error.code) {
    case ERROR_CODES.CONSENT_CONTACT_NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.CONSENT_NOTE_REQUIRED:
      return 'noteRequired';
    case ERROR_CODES.CONSENT_NOTICE_TARGET_NOT_FOUND:
      return 'noticeTargetMissing';
    case ERROR_CODES.CONSENT_NOTICE_INVALID:
      return 'validation';
    case ERROR_CODES.CONSENT_SETTINGS_INVALID:
      return 'settingsInvalid';
    case ERROR_CODES.CONSENT_EXPORT_IN_PROGRESS:
      return 'exportInProgress';
    case ERROR_CODES.CONSENT_EXPORT_NOT_READY:
      return 'exportNotReady';
    case ERROR_CODES.CONSENT_EXPORT_NOT_FOUND:
      return 'notFound';
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
