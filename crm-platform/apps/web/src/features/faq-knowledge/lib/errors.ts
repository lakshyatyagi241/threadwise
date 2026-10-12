import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The message key (under `faq.errors`) for a failed call. Branch on `code`, never on the server's wording. */
export type ErrorKey =
  | 'network'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'duplicateQuestion'
  | 'duplicateVariation'
  | 'limitReached'
  | 'flowNotFound'
  | 'flowNodeNotFound'
  | 'embeddingUnavailable'
  | 'engineDisabled'
  | 'modelNotAllowed'
  | 'validation'
  | 'rateLimited'
  | 'unexpected';

export function errorKey(error: unknown): ErrorKey {
  if (!(error instanceof ApiError)) return 'network';
  if (error.status === 403 || error.code === ERROR_CODES.FORBIDDEN) return 'forbidden';
  switch (error.code) {
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return 'conflict';
    case ERROR_CODES.FAQ_DUPLICATE_QUESTION:
      return 'duplicateQuestion';
    case ERROR_CODES.FAQ_LIMIT_REACHED:
      return 'limitReached';
    case ERROR_CODES.FAQ_FLOW_NOT_FOUND:
      return 'flowNotFound';
    case ERROR_CODES.FAQ_FLOW_NODE_NOT_FOUND:
      return 'flowNodeNotFound';
    case ERROR_CODES.FAQ_EMBEDDING_UNAVAILABLE:
      return 'embeddingUnavailable';
    case ERROR_CODES.FAQ_ENGINE_DISABLED:
      return 'engineDisabled';
    case ERROR_CODES.FAQ_MODEL_NOT_ALLOWED:
      return 'modelNotAllowed';
    case ERROR_CODES.NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.VALIDATION_FAILED:
      return 'validation';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
    case ERROR_CODES.CONFLICT:
      // A variation the FAQ already has comes back as the generic conflict with a `text` path.
      return error.fieldErrors.some((e) => e.path === 'text') ? 'duplicateVariation' : 'conflict';
    default:
      return error.status === 404 ? 'notFound' : 'unexpected';
  }
}

export const isRowVersionConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ERROR_CODES.ROW_VERSION_CONFLICT;

export const isEmbeddingUnavailable = (error: unknown): boolean =>
  error instanceof ApiError && error.code === ERROR_CODES.FAQ_EMBEDDING_UNAVAILABLE;

/** Server-side field problems of a 422 as `path -> message`, for the ones the local rules did not catch. */
export function serverFieldProblems(error: unknown): Array<{ path: string; message: string }> {
  return error instanceof ApiError && error.code === ERROR_CODES.VALIDATION_FAILED
    ? error.fieldErrors
    : [];
}

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;
