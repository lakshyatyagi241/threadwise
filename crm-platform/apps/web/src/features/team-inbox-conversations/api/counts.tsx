'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';
import type { InboxCounts } from '@crm/contracts';
import { NavCountsContext } from '@/components/shell/nav-badges';
import { BACKGROUND_META } from '@/lib/api/background';
import { useRealtimeStatus } from '@/lib/realtime';
import { inboxApi } from './service';

/**
 * The inbox's tab counts as one shared cache entry. The Inbox screen keeps its own copy in its reducer and publishes every change
 * here (see `usePublishCounts`); the menu badge reads it on every page, and the live notifications invalidate it on the inbox's
 * socket signals. (The notifications domain names the same key for its invalidation: keep the two in step.)
 */
export const INBOX_COUNTS_KEY = ['inbox', 'counts'] as const;

/** While the socket is connected the signals keep the count fresh, so the safety poll is slow; without it the poll is quick. */
export const CONNECTED_POLL_MS = 5 * 60_000;
export const DISCONNECTED_POLL_MS = 30_000;

export function pollMsFor(status: ReturnType<typeof useRealtimeStatus>): number {
  return status === 'connected' ? CONNECTED_POLL_MS : DISCONNECTED_POLL_MS;
}

/**
 * The number of conversations with unread messages, for the menu badge. `null` until the first answer, and it keeps the last
 * answer through refetches and failures, so the badge never flickers to zero while it refreshes. Only fetched for a person who
 * may read conversations (the server would refuse the rest).
 */
export function useInboxUnreadCount(enabled: boolean): number | null {
  const interval = pollMsFor(useRealtimeStatus());
  const query = useQuery({
    queryKey: INBOX_COUNTS_KEY,
    queryFn: ({ signal }) => inboxApi.counts(null, signal),
    meta: BACKGROUND_META,
    enabled,
    // Only while the tab is in front (and safe to evaluate on the server, where there is no document).
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden' ? false : interval,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
  return enabled ? (query.data?.unread ?? null) : null;
}

/** Puts the Inbox screen's own counts in the shared cache, so the menu badge agrees with the tabs the moment they change. */
export function usePublishCounts(counts: InboxCounts | null): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (counts) qc.setQueryData<InboxCounts>(INBOX_COUNTS_KEY, counts);
  }, [qc, counts]);
}

/** Provides the menu's Inbox badge number. Mount it once around the app shell. */
export function InboxNavCounts({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const unread = useInboxUnreadCount(enabled);
  const value = useMemo(() => (unread === null ? {} : { 'inbox-unread': unread }), [unread]);
  return <NavCountsContext.Provider value={value}>{children}</NavCountsContext.Provider>;
}
