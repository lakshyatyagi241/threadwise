import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export type ErrorKind =
  | 'forbidden'
  | 'conflict'
  | 'urlRejected'
  | 'validation'
  | 'notFound'
  | 'network'
  | 'request'
  | 'unexpected';

/** Which message to show for a failed call. Branches on the stable code and status, never on the server's wording. */
export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  if (error.isRowVersionConflict) return 'conflict';
  if (error.code === ERROR_CODES.WFWD_URL_REJECTED) return 'urlRejected';
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'notFound';
  if (error.status === 422 || error.status === 400) return 'validation';
  return error.status >= 500 ? 'unexpected' : 'request';
}
