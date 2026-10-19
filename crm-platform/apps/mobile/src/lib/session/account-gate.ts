import { ERROR_CODES, type SessionResponse } from '@crm/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { isApiError } from '@/lib/api/errors';
import { sessionKey } from './use-session';

/**
 * The account gates (TW-AUTH-016, 032, 035): a signed-in person the API will not serve until they do one thing. The order is the
 * API guard's own (`account-gate.guard.ts`) and the web's (`gate-target.ts`): suspended, then a forced password change, then required
 * two-factor enrolment, then an unverified email when the policy blocks. Workspace onboarding (`landing: onboarding`) is not a gate
 * the API enforces and is not handled here.
 */
export type Gate = 'suspended' | 'password' | 'mfa' | 'email';

export function gateOf(session: SessionResponse): Gate | null {
  const { flags } = session;
  if (flags.suspended) return 'suspended';
  if (flags.passwordChangeRequired) return 'password';
  if (flags.mfaEnrolmentRequired) return 'mfa';
  if (flags.emailBlocked) return 'email';
  return null;
}

/** The error codes that mean "a gate closed on this person since the session was read": the session is read again to find which. */
const GATE_ERROR_CODES: ReadonlySet<string> = new Set([
  ERROR_CODES.AUTH_ACCOUNT_SUSPENDED,
  ERROR_CODES.AUTH_PASSWORD_CHANGE_REQUIRED,
  ERROR_CODES.AUTH_MFA_ENROLMENT_REQUIRED,
  ERROR_CODES.AUTH_EMAIL_UNVERIFIED,
]);

// The whole workspace being suspended is not a flag on the session: every call answers WSP_ORG_SUSPENDED. The app remembers that it saw
// it (in memory only), so the person is held at the suspended screen instead of on screens that can only fail.
let workspaceSuspended = false;
const listeners = new Set<() => void>();

function setWorkspaceSuspended(value: boolean): void {
  if (workspaceSuspended === value) return;
  workspaceSuspended = value;
  for (const l of [...listeners]) l();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** True after the API said the workspace is suspended, until the person checks again (or signs out). */
export const useWorkspaceSuspended = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => workspaceSuspended,
    () => false,
  );

/** Forgets that the workspace was suspended: on "check again" (the next call says so again if it still is) and on sign-out. */
export const clearWorkspaceSuspended = (): void => setWorkspaceSuspended(false);

/**
 * Called by the query cache for every failed read or write. A gate error re-reads the session (its flags say which gate it is); a
 * suspended workspace is remembered. Anything else is none of its business.
 */
export function noteGateError(error: unknown, queryClient: QueryClient): void {
  if (!isApiError(error)) return;
  if (error.code === ERROR_CODES.WSP_ORG_SUSPENDED) {
    setWorkspaceSuspended(true);
    return;
  }
  if (GATE_ERROR_CODES.has(error.code))
    void queryClient.invalidateQueries({ queryKey: sessionKey });
}
