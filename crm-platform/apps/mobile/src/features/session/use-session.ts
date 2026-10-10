import { useQuery } from '@tanstack/react-query';
import { fetchSession } from './api';

export const sessionKey = ['session'] as const;

/** The signed-in person and their workspace. Permissions here decide what a screen shows; the API enforces them regardless. */
export function useSession() {
  return useQuery({ queryKey: sessionKey, queryFn: ({ signal }) => fetchSession(signal) });
}
