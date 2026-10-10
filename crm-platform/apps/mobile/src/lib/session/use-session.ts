import { useQuery } from '@tanstack/react-query';
import type { SessionResponse } from '@crm/contracts';
import { fetchSession } from './api';

export const sessionKey = ['session'] as const;

/** The signed-in person and their workspace. Permissions here decide what a screen shows; the API enforces them regardless. */
export function useSession() {
  return useQuery({ queryKey: sessionKey, queryFn: ({ signal }) => fetchSession(signal) });
}

/** Whether the session grants a permission key. Denied keys are absent from the session, so presence is the answer. */
export const can = (session: SessionResponse | undefined, permission: string): boolean =>
  session !== undefined && Object.hasOwn(session.permissions, permission);
