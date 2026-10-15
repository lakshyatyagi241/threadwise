import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** What the person is told about a failed call, chosen by error `code`, never by the server's wording. */
export const ERROR_KINDS = [
  'network',
  'forbidden',
  'signedOut',
  'conflict',
  'validation',
  'unavailable',
  'rateLimited',
  'notFound',
  'planDisabled',
  'nameTaken',
  'notEditable',
  'archived',
  'unexpected',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export function errorKind(error: unknown): ErrorKind {
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
    case ERROR_CODES.EMAIL_TEMPLATE_NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.PLAN_FEATURE_LOCKED:
      return 'planDisabled';
    case ERROR_CODES.EMAIL_TEMPLATE_NAME_TAKEN:
      return 'nameTaken';
    case ERROR_CODES.EMAIL_TEMPLATE_NOT_EDITABLE:
      return 'notEditable';
    case ERROR_CODES.EMAIL_TEMPLATE_ARCHIVED:
      return 'archived';
  }
  // A route that is not deployed answers 404 or 501 without one of our codes for it.
  if (error.status === 404 || error.status === 501) return 'unavailable';
  return 'unexpected';
}
