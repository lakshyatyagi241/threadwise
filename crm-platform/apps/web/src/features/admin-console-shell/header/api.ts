'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  healthResponseSchema,
  operatorNotificationsPageSchema,
  operatorNotificationsRecentSchema,
  operatorNotificationsSeenSchema,
  type OperatorNotificationsQuery,
} from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

const RECENT_KEY = ['operator', 'notifications', 'recent'] as const;
const POLL_MS = 60_000;

/** The health snapshot behind the header pill. A failure is not shown: the pill just stays quiet. */
export function useHealthSnapshot(enabled: boolean) {
  return useQuery({
    queryKey: ['operator', 'health-pill'],
    queryFn: ({ signal }) => operatorFetch('/health', { schema: healthResponseSchema, signal }),
    enabled,
    refetchInterval: POLL_MS,
    staleTime: 20_000,
    retry: false,
  }).data;
}

/** The bell's feed: loads at once, then every 60 s while the tab is visible (react-query pauses polling in a hidden tab). */
export function useBellFeed(enabled: boolean) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: RECENT_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/notifications/recent', { schema: operatorNotificationsRecentSchema, signal }),
    enabled,
    refetchInterval: POLL_MS,
    retry: false,
  });
  const markRead = async (clear: boolean) => {
    await operatorFetch(clear ? '/notifications' : '/notifications/read-all', {
      method: clear ? 'DELETE' : 'POST',
      schema: operatorNotificationsSeenSchema,
    });
    await client.invalidateQueries({ queryKey: RECENT_KEY });
  };
  return { ...query, markRead };
}

export function useNotificationsPage(q: OperatorNotificationsQuery) {
  const client = useQueryClient();
  return useQuery({
    queryKey: ['operator', 'notifications', 'page', q.type, q.q ?? ''],
    queryFn: async ({ signal }) => {
      const page = await operatorFetch('/notifications', {
        query: { type: q.type, q: q.q },
        schema: operatorNotificationsPageSchema,
        signal,
      });
      // Opening the page marks everything seen, so the bell badge is stale now.
      void client.invalidateQueries({ queryKey: RECENT_KEY });
      return page;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
}
