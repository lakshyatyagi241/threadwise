import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export type ErrorKind =
  | 'forbidden'
  | 'active'
  | 'dryRequired'
  | 'confirm'
  | 'notCancellable'
  | 'collision'
  | 'schedule'
  | 'validation'
  | 'notFound'
  | 'network'
  | 'request'
  | 'unexpected';

/** Which message to show for a failed call. Branches on the stable code and status, never on the server's wording. */
export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  if (error.code === ERROR_CODES.WMIG_RUN_ACTIVE) return 'active';
  if (error.code === ERROR_CODES.WMIG_DRY_RUN_REQUIRED) return 'dryRequired';
  if (error.code === ERROR_CODES.WMIG_CONFIRM_MISMATCH) return 'confirm';
  if (error.code === ERROR_CODES.WMIG_NOT_CANCELLABLE) return 'notCancellable';
  if (error.code === ERROR_CODES.WMIG_CLIENT_COLLISION) return 'collision';
  if (error.code === ERROR_CODES.WMIG_SCHEDULE_INVALID) return 'schedule';
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'notFound';
  if (error.status === 422 || error.status === 400) return 'validation';
  return error.status >= 500 ? 'unexpected' : 'request';
}

/** An organization id (= Waboo database name) as the API accepts it (same rule as the contract). */
export { WMIG_CLIENT_RE, WMIG_DB_RE } from '@crm/contracts';
