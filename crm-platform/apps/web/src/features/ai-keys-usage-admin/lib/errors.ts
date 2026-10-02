import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export type ErrorKind =
  | 'forbidden'
  | 'conflict'
  | 'keyRequired'
  | 'validation'
  | 'notFound'
  | 'network'
  | 'request'
  | 'unexpected';

/** Which message to show for a failed call. Branches on the stable code and status, never on the server's wording. */
export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  if (error.isRowVersionConflict) return 'conflict';
  if (error.code === ERROR_CODES.AIADM_KEY_REQUIRED) return 'keyRequired';
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'notFound';
  if (error.status === 422) return 'validation';
  return error.status >= 500 ? 'unexpected' : 'request';
}
