import type { SessionResponse } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { signOut } from '@/lib/auth/sign-out';
import {
  clearWorkspaceSuspended,
  gateOf,
  useWorkspaceSuspended,
  type Gate,
} from '@/lib/session/account-gate';
import { sessionKey } from '@/lib/session/use-session';
import { clearRecoveryCodes, useRecoveryCodes } from './recovery-codes-store';

/**
 * Which lock screen the signed-in app must show, or null. The session's flags decide, plus two things the flags cannot say: the whole
 * workspace being suspended (seen as an error on a call), and recovery codes that are still waiting to be saved (they keep the
 * two-factor screen up after the flag has cleared).
 */
export function useAccountGate(session: SessionResponse | undefined): Gate | null {
  const workspaceSuspended = useWorkspaceSuspended();
  const unsavedCodes = useRecoveryCodes();
  if (workspaceSuspended) return 'suspended';
  const gate = session ? gateOf(session) : null;
  if (gate === null && unsavedCodes !== null) return 'mfa';
  return gate;
}

/** Reads the session again (and, after a suspension, everything else) to see whether the gate has opened. */
export function useRecheck() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const recheck = useCallback(async () => {
    setPending(true);
    try {
      clearWorkspaceSuspended();
      await queryClient.invalidateQueries({ queryKey: sessionKey, refetchType: 'all' });
      await queryClient.invalidateQueries();
    } finally {
      setPending(false);
    }
  }, [queryClient]);
  return { recheck, pending };
}

/** Signs out from a lock screen: ends the session, empties the cache, and drops anything held only in memory. */
export function useGateSignOut() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const run = useCallback(async () => {
    setPending(true);
    clearRecoveryCodes();
    try {
      await signOut(queryClient);
    } finally {
      setPending(false);
    }
  }, [queryClient]);
  return { signOut: run, pending };
}
