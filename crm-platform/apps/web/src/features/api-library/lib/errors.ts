import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The message key (under `api-library.errors`) for a failed call. Branch on `code`, never on the server's wording. */
export type ErrorKey =
  | 'network'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'nameTaken'
  | 'inUse'
  | 'limit'
  | 'validation'
  | 'rateLimited'
  | 'unexpected';

export function errorKey(error: unknown): ErrorKey {
  if (!(error instanceof ApiError)) return 'network';
  if (error.status === 403 || error.code === ERROR_CODES.FORBIDDEN) return 'forbidden';
  switch (error.code) {
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return 'conflict';
    case ERROR_CODES.ALIB_NAME_TAKEN:
      return 'nameTaken';
    case ERROR_CODES.ALIB_IN_USE:
      return 'inUse';
    case ERROR_CODES.ALIB_LIMIT_REACHED:
      return 'limit';
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

/** The flows that still use an API, from the 409 `ALIB_IN_USE` details (`path` = flow id, `message` = flow name). */
export function flowsInUse(error: unknown): Array<{ id: string; name: string }> {
  if (!(error instanceof ApiError) || error.code !== ERROR_CODES.ALIB_IN_USE) return [];
  return error.fieldErrors.map((e) => ({ id: e.path, name: e.message }));
}

/** Server-side field problems of a 422 as `path -> message`, for the ones the local rules did not catch. */
export function serverFieldProblems(error: unknown): Array<{ path: string; message: string }> {
  return error instanceof ApiError && error.code === ERROR_CODES.VALIDATION_FAILED
    ? error.fieldErrors
    : [];
}

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;
