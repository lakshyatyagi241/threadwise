import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { fieldMessage } from './api-errors';

/**
 * Which sentence a failed plan call gets. The API says why in a stable `code`
 * (never match its wording): a plan some workspaces are on cannot be deleted
 * (WD-PLAN-005, with how many), the signup default cannot be deactivated or
 * deleted (WD-PLAN-004).
 */
export type PlanErrorKind =
  | { key: 'inUse'; count: number }
  | { key: 'defaultProtected' }
  | { key: 'notFound' }
  | { key: 'forbidden' }
  | { key: 'generic' };

export function planErrorKind(error: unknown): PlanErrorKind {
  if (!(error instanceof ApiError)) return { key: 'generic' };
  if (error.code === ERROR_CODES.PLAN_IN_USE) {
    const n = Number(fieldMessage(error, 'inUse'));
    return { key: 'inUse', count: Number.isFinite(n) && n >= 0 ? n : 0 };
  }
  if (error.code === ERROR_CODES.PLAN_DEFAULT_PROTECTED) return { key: 'defaultProtected' };
  if (error.status === 404) return { key: 'notFound' };
  if (error.status === 403) return { key: 'forbidden' };
  return { key: 'generic' };
}
