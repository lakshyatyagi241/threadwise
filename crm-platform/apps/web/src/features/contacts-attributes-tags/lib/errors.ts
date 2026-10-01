import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** What the person is told about a failed call. Chosen by error `code` (never by the server's wording). */
export type ErrorKind =
  | 'network'
  | 'forbidden'
  | 'signedOut'
  | 'conflict'
  | 'keyTaken'
  | 'reservedKey'
  | 'attributeInUse'
  | 'nameTaken'
  | 'importFile'
  | 'tooLarge'
  | 'mergeScope'
  | 'systemField'
  | 'validation'
  | 'unavailable'
  | 'rateLimited'
  | 'unexpected';

export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.code) {
    case ERROR_CODES.FORBIDDEN:
      return 'forbidden';
    case ERROR_CODES.UNAUTHENTICATED:
      return 'signedOut';
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return 'conflict';
    case ERROR_CODES.FIELD_KEY_TAKEN:
      return 'keyTaken';
    case ERROR_CODES.FIELD_IS_SYSTEM:
      return 'systemField';
    case ERROR_CODES.CON_ATTRIBUTE_KEY_RESERVED:
      return 'reservedKey';
    case ERROR_CODES.CON_ATTRIBUTE_IN_USE:
      return 'attributeInUse';
    case ERROR_CODES.CON_GROUP_NAME_TAKEN:
    case ERROR_CODES.CON_TAG_NAME_TAKEN:
      return 'nameTaken';
    case ERROR_CODES.CON_IMPORT_FILE_INVALID:
      return 'importFile';
    case ERROR_CODES.CON_IMPORT_TOO_LARGE:
    case ERROR_CODES.CON_EXPORT_TOO_LARGE:
    case ERROR_CODES.CON_SELECTION_TOO_LARGE:
      return 'tooLarge';
    case ERROR_CODES.CON_MERGE_SCOPE_REQUIRED:
      return 'mergeScope';
    case ERROR_CODES.VALIDATION_FAILED:
      return 'validation';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
  }
  // A route that is not there yet answers 404/501 without one of our codes for it.
  if (error.status === 404 || error.status === 501) return 'unavailable';
  return 'unexpected';
}

/** `{ path: message }` from the server's per-field errors, first message per path. */
export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(error instanceof ApiError)) return out;
  for (const f of error.fieldErrors) if (!(f.path in out)) out[f.path] = f.message;
  return out;
}

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;
