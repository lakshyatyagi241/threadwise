'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteNotificationsResponseSchema,
  notificationListResponseSchema,
  notificationSummaryResponseSchema,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { NOTIFICATION_KEYS } from '../api/keys';
import { pollIntervalFor } from '../api/hooks';
import { useRealtimeStatus } from '@/lib/realtime';
import type { PageFilters } from './model';

export const PAGE_SIZE = 20;

/**
 * Both keys sit UNDER the bell's `['notifications', 'feed']`, so the live controller's "something changed" invalidation (a new row, a
 * read on another tab, a reconnect) refreshes this page too, with no second listener. While the socket is down it polls like the bell.
 */
const PAGE_KEYS = {
  list: (f: PageFilters) => [...NOTIFICATION_KEYS.feed, 'page', f] as const,
  summary: [...NOTIFICATION_KEYS.feed, 'summary'] as const,
};

export function useNotificationsPage(filters: PageFilters) {
  const interval = pollIntervalFor(useRealtimeStatus());
  return useInfiniteQuery({
    queryKey: PAGE_KEYS.list(filters),
    retry: false,
    staleTime: 15_000,
    refetchInterval: interval,
    refetchOnWindowFocus: true,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/notifications', {
        query: {
          limit: PAGE_SIZE,
          cursor: pageParam,
          unreadOnly: filters.read === 'unread' ? true : undefined,
          type: filters.type || undefined,
          q: filters.q || undefined,
        },
        schema: notificationListResponseSchema,
        signal,
      }),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
}

export function useNotificationSummary() {
  const interval = pollIntervalFor(useRealtimeStatus());
  return useQuery({
    queryKey: PAGE_KEYS.summary,
    retry: false,
    staleTime: 15_000,
    refetchInterval: interval,
    queryFn: ({ signal }) =>
      apiFetch('/notifications/summary', { schema: notificationSummaryResponseSchema, signal }),
  });
}

/** Dismisses one of my notifications (the X on a row); the badge and the list are read again. */
export function useDismissNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/notifications/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        schema: deleteNotificationsResponseSchema,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
