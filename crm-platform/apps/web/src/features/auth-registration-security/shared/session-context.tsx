'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SessionResponse } from '@crm/contracts';

const SessionContext = createContext<SessionResponse | null>(null);

/** The signed-in staff session, fetched once by the (app) layout and shared with client components. */
export function SessionProvider({
  session,
  children,
}: {
  session: SessionResponse;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionResponse {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside the (app) layout');
  return s;
}

/** The session when there is one around; null in isolation (a test, a story). */
export const useOptionalSession = (): SessionResponse | null => useContext(SessionContext);

/** True when the caller holds the permission. Absent = denied. */
export function useCan(permission: string): boolean {
  return permission in useSession().permissions;
}
