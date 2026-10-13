'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationListResponse } from '@crm/contracts';
import { BACKGROUND_META } from '@/lib/api/background';
import { useRealtimeStatus } from '@/lib/realtime';
import { NOTIFICATION_KEYS } from './keys';
import { notificationsApi } from './service';

export { NOTIFICATION_KEYS };

/**
 * While the live socket is connected the server pushes every change, so the bell does not poll. Without a connection (not
 * configured, connecting, dropped) it polls once a minute, as Reference's bell did, and always again when the window regains focus.
 * A reconnect fetches once more by itself (the live provider asks for a catch-up).
 */
export const POLL_MS = 60_000;
export const FEED_SIZE = 8;

/** The poll interval for the current socket state: none while the socket is connected, `POLL_MS` otherwise. */
export function pollIntervalFor(status: ReturnType<typeof useRealtimeStatus>): number | false {
  return status === 'connected' ? false : POLL_MS;
}

/** The badge. A failure only hides the count: the bell still opens. */
export function useUnreadCount() {
  const interval = pollIntervalFor(useRealtimeStatus());
  return useQuery({
    queryKey: NOTIFICATION_KEYS.unread,
    queryFn: ({ signal }) => notificationsApi.unread(signal),
    meta: BACKGROUND_META,
    refetchInterval: interval,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    retry: false,
  });
}

/** The newest few, fetched while the panel is open. */
export function useFeed(open: boolean) {
  const interval = pollIntervalFor(useRealtimeStatus());
  return useQuery({
    queryKey: NOTIFICATION_KEYS.feed,
    queryFn: ({ signal }) => notificationsApi.list(FEED_SIZE, signal),
    enabled: open,
    refetchInterval: open ? interval : false,
    staleTime: 0,
    retry: false,
  });
}

/**
 * Marks one notification read, or all of them. The badge and the list change at once and are rolled back to the server's
 * answer if the call fails.
 */
export function useMarkRead() {
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.unread });
    void qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.feed });
  };
  const one = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onMutate: (id) => {
      const feed = qc.getQueryData<NotificationListResponse>(NOTIFICATION_KEYS.feed);
      const was = feed?.data.find((n) => n.id === id);
      if (was && was.readAt === null) {
        qc.setQueryData<NotificationListResponse>(NOTIFICATION_KEYS.feed, {
          ...feed!,
          data: feed!.data.map((n) =>
            n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
          ),
          meta: { unread: Math.max(0, feed!.meta.unread - 1) },
        });
        qc.setQueryData<number>(NOTIFICATION_KEYS.unread, (n) => Math.max(0, (n ?? 1) - 1));
      }
    },
    onSettled: settle,
  });
  const all = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onMutate: () => {
      const feed = qc.getQueryData<NotificationListResponse>(NOTIFICATION_KEYS.feed);
      if (feed) {
        const now = new Date().toISOString();
        qc.setQueryData<NotificationListResponse>(NOTIFICATION_KEYS.feed, {
          ...feed,
          data: feed.data.map((n) => (n.readAt ? n : { ...n, readAt: now })),
          meta: { unread: 0 },
        });
      }
      qc.setQueryData<number>(NOTIFICATION_KEYS.unread, 0);
    },
    onSettled: settle,
  });
  return { markRead: one.mutate, markAllRead: all.mutate, markingAll: all.isPending };
}
