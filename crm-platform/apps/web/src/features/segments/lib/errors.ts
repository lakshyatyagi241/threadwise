import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** What the person is told about a failed segments call. Chosen by error `code`, never by the server's wording. */
export type SegmentErrorKind =
  | 'network'
  | 'forbidden'
  | 'signedOut'
  | 'conflict'
  | 'validation'
  | 'notFound'
  | 'nameTaken'
  | 'rulesInvalid'
  | 'rateLimited'
  | 'planLimit'
  | 'unavailable'
  | 'unexpected';

export function errorKind(error: unknown): SegmentErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.code) {
    case ERROR_CODES.FORBIDDEN:
      return 'forbidden';
    case ERROR_CODES.UNAUTHENTICATED:
      return 'signedOut';
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return 'conflict';
    case ERROR_CODES.VALIDATION_FAILED:
      return 'validation';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
    case ERROR_CODES.NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.PLAN_LIMIT_REACHED:
      return 'planLimit';
    case ERROR_CODES.SEG_NAME_TAKEN:
      return 'nameTaken';
    case ERROR_CODES.SEG_RULES_INVALID:
      return 'rulesInvalid';
  }
  if (error.status === 404) return error.code === 'UNKNOWN' ? 'unavailable' : 'notFound';
  if (error.status === 501) return 'unavailable';
  return 'unexpected';
}

/** A 404 with no problem body: the route is not served yet (the API is still being built), not a missing segment. */
export const isUnavailable = (error: unknown): boolean => errorKind(error) === 'unavailable';

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;

export function fieldErrorsOf(error: unknown): Array<{ path: string; message: string }> {
  return error instanceof ApiError ? error.fieldErrors : [];
}
