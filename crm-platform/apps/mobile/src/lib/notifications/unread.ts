import { notificationListResponseSchema } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { visibleRows } from './hidden';

/** Unread rows read to count the ones the app shows: the most a list page may hold (the API refuses more). */
const COUNT_WINDOW = 50;

/** How often the badge asks again while the app is open (the web bell polls once a minute too). */
const REFETCH_MS = 60_000;

export const unreadKey = ['notifications', 'unread'] as const;

/**
 * How many unread notifications the signed-in person has that the app shows: the bell's badge and dot. The server's own total
 * (`GET /v2/notifications/unread-count`) also counts the kinds the app hides, so the newest unread rows are read instead and the
 * hidden ones left out. With more than `COUNT_WINDOW` unread rows this counts only those, so it can be lower than the true number
 * (never zero while one of the newest is shown).
 */
export async function fetchUnreadCount(signal?: AbortSignal): Promise<number> {
  const page = await apiFetch('/v2/notifications', {
    query: { limit: COUNT_WINDOW, unreadOnly: true },
    schema: notificationListResponseSchema,
    signal,
  });
  return visibleRows(page.data).length;
}

/** The unread total, refreshed every minute and whenever the app comes back to the front. */
export function useUnreadCount() {
  return useQuery({
    queryKey: unreadKey,
    queryFn: ({ signal }) => fetchUnreadCount(signal),
    refetchInterval: REFETCH_MS,
  });
}
