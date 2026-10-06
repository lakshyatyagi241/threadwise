import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/**
 * What the person is told about a failed call, chosen by error `code` (then by status), never by the server's wording. A screen maps
 * each kind to a message of its own (`web-forms.errors.<kind>`).
 */
export const ERROR_KINDS = [
  'network',
  'forbidden',
  'signedOut',
  'conflict',
  'nameTaken',
  'stateInvalid',
  'definitionInvalid',
  'publishInvalid',
  'planLimit',
  'planLocked',
  'notFound',
  'rateLimited',
  'unexpected',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.code) {
    case ERROR_CODES.FORMS_NAME_TAKEN:
      return 'nameTaken';
    case ERROR_CODES.FORMS_STATE_INVALID:
      return 'stateInvalid';
    case ERROR_CODES.FORMS_DEFINITION_INVALID:
      return 'definitionInvalid';
    case ERROR_CODES.FORMS_PUBLISH_INVALID:
      return 'publishInvalid';
    case ERROR_CODES.PLAN_LIMIT_REACHED:
      return 'planLimit';
    case ERROR_CODES.PLAN_FEATURE_LOCKED:
      return 'planLocked';
    case ERROR_CODES.FORBIDDEN:
      return 'forbidden';
    case ERROR_CODES.UNAUTHENTICATED:
      return 'signedOut';
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return 'conflict';
    case ERROR_CODES.NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
    default:
      break;
  }
  if (error.status === 404) return 'notFound';
  if (error.status === 429) return 'rateLimited';
  return 'unexpected';
}

/** The publish problems the API lists (`path: reason`), as `{ path, reason }` pairs, for the checklist the Publish button shows. */
export function publishProblems(error: unknown): Array<{ path: string; reason: string }> {
  if (!(error instanceof ApiError) || error.code !== ERROR_CODES.FORMS_PUBLISH_INVALID) return [];
  return error.fieldErrors.map((e) => ({ path: e.path, reason: e.message }));
}
