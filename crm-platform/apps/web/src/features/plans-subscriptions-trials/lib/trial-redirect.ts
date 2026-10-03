import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { PLANS_PATH } from './format';

/** Pages that must keep working after the trial ends, so the redirect never loops (WD-PLAN-015 rule 2). */
const OPEN_PREFIXES = ['/account', '/billing', '/support', '/login', '/register'];

/**
 * The trial hard gate answers feature calls with 402 PLAN_TRIAL_EXPIRED. The page the person is on cannot render, so send them
 * to the plan picker once, as WaDesk's middleware redirect does. Pass any error from a query or a mutation.
 */
export function redirectOnTrialExpired(
  error: unknown,
  pathname: string,
  go: (to: string) => void,
): boolean {
  if (!(error instanceof ApiError) || error.code !== ERROR_CODES.PLAN_TRIAL_EXPIRED) return false;
  if (OPEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  go(PLANS_PATH);
  return true;
}
