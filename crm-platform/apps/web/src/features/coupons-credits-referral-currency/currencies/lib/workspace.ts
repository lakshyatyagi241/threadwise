import { ERROR_CODES, type WorkspaceCurrencyResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The permission the API requires to change the workspace currency. */
export const OWNER_PERMISSION = 'org.owner_settings.manage';

/** The select's value for "follow the platform default" (an empty string is the request's `null`). */
export const FOLLOW_DEFAULT = '';

export const selectedValue = (data: Pick<WorkspaceCurrencyResponse, 'currency'>): string =>
  data.currency ?? FOLLOW_DEFAULT;

/** The request body: blank means null. */
export const workspaceBody = (value: string): { currency: string | null } => ({
  currency: value === FOLLOW_DEFAULT ? null : value,
});

/** Nothing to save when the choice is the stored one. */
export const isDirty = (
  data: Pick<WorkspaceCurrencyResponse, 'currency'>,
  value: string,
): boolean => value !== selectedValue(data);

export type WorkspaceErrorKind = 'invalid' | 'forbidden' | 'validation' | 'network' | 'generic';
export function workspaceErrorKind(err: unknown): WorkspaceErrorKind {
  if (!(err instanceof ApiError)) return 'network';
  if (err.code === ERROR_CODES.CPN_WORKSPACE_CURRENCY_INVALID) return 'invalid';
  if (err.status === 403) return 'forbidden';
  if (err.code === 'VALIDATION_FAILED') return 'validation';
  return 'generic';
}
