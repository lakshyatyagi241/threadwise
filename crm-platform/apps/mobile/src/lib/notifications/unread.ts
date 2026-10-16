import { unreadCountResponseSchema } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

/** How often the badge asks again while the app is open (the web bell polls once a minute too). */
const REFETCH_MS = 60_000;

export const unreadKey = ['notifications', 'unread'] as const;

/** How many unread notifications the signed-in person has (`GET /v2/notifications/unread-count`): the badge on the bell. */
export async function fetchUnreadCount(signal?: AbortSignal): Promise<number> {
  const answer = await apiFetch('/v2/notifications/unread-count', {
    schema: unreadCountResponseSchema,
    signal,
  });
  return answer.unread;
}

/** The unread total, refreshed every minute and whenever the app comes back to the front. */
export function useUnreadCount() {
  return useQuery({
    queryKey: unreadKey,
    queryFn: ({ signal }) => fetchUnreadCount(signal),
    refetchInterval: REFETCH_MS,
  });
}
