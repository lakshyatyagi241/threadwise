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
  | 'statusInUse'
  | 'dependencyCycle'
  | 'nameTaken'
  | 'importFile'
  | 'tooLarge'
  | 'mergeScope'
  | 'requiredProperty'
  | 'lostReason'
  | 'stageFlag'
  | 'statusStage'
  | 'stageScope'
  | 'systemField'
  | 'validation'
  | 'unavailable'
  | 'rateLimited'
  | 'planLimit'
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
    case ERROR_CODES.DEPENDENCY_CYCLE_DETECTED:
      return 'dependencyCycle';
    case ERROR_CODES.STATUS_OPTION_IN_USE:
      return 'statusInUse';
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
    case ERROR_CODES.CON_REQUIRED_PROPERTY_MISSING:
      return 'requiredProperty';
    case ERROR_CODES.CON_LOST_REASON_REQUIRED:
      return 'lostReason';
    case ERROR_CODES.STATUS_OPTION_FLAG_INVALID:
      return 'stageFlag';
    case ERROR_CODES.CON_STATUS_STAGE_MISMATCH:
      return 'statusStage';
    case ERROR_CODES.STATUS_OPTION_STAGE_INVALID:
      return 'stageScope';
    case ERROR_CODES.VALIDATION_FAILED:
      return 'validation';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
    case ERROR_CODES.PLAN_LIMIT_REACHED:
      return 'planLimit';
  }
  // A route that is not there yet answers 404/501 without one of our codes for it.
  if (error.status === 404 || error.status === 501) return 'unavailable';
  return 'unexpected';
}

/**
 * What a failed single-record delete means. A 404 on `DELETE /contacts/:id` is a record that is already gone (deleted in
 * another tab or by someone else), which is not "this action is not available yet": the list is stale, nothing else.
 */
export function deleteFailure(error: unknown): 'gone' | 'forbidden' | 'failed' {
  if (error instanceof ApiError && error.status === 404) return 'gone';
  return errorKind(error) === 'forbidden' ? 'forbidden' : 'failed';
}

/** `{ path: message }` from the server's per-field errors, first message per path. */
export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(error instanceof ApiError)) return out;
  for (const f of error.fieldErrors) if (!(f.path in out)) out[f.path] = f.message;
  return out;
}

/** The plan's cap from a PLAN_LIMIT_REACHED answer (`limitValue`), for the message; undefined when it is not there. */
export function planLimitOf(error: unknown): number | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const raw = error.fieldErrors.find((f) => f.path === 'limitValue')?.message;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;
