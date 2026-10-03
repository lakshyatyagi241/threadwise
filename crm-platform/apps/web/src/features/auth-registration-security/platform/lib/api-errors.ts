import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The API refused because the operator's role may not do this (not because of an IP block or missing MFA). */
export const isRoleRefusal = (error: unknown): error is ApiError =>
  error instanceof ApiError &&
  error.status === 403 &&
  error.code === ERROR_CODES.AUTH_OPERATOR_ROLE_REQUIRED;

/** The message the API attached to one field path, if any. */
export function fieldMessage(error: ApiError, path: string): string | undefined {
  return error.fieldErrors.find((e) => e.path === path)?.message;
}

/** Seconds a locked-out caller must wait (rate-limit and lockout errors carry them as a field error). */
export function retryAfterSeconds(error: ApiError): number | null {
  const raw = fieldMessage(error, 'retryAfterSeconds');
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** Field errors keyed by their full path; the first message wins when a path repeats. */
export function fieldErrorMap(error: ApiError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of error.fieldErrors) if (!(e.path in out)) out[e.path] = e.message;
  return out;
}

/** `abuseBlockKeywordList.3` -> `abuseBlockKeywordList`: a list item error belongs to its list's control. */
export function rootPath(path: string): string {
  return path.split('.')[0] ?? path;
}
