'use client';

import { useQuery } from '@tanstack/react-query';
import {
  broadcastDetailSchema,
  broadcastLiveStatsSchema,
  broadcastRecipientSchema,
  resumeBroadcastResponseSchema,
  retryBroadcastResponseSchema,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { KEYS } from './broadcasts';

/** The live counters are polled every 12 s while the broadcast is in flight and stop once it settles (as Reference did). */
export const LIVE_POLL_MS = 12_000;

export const detailKey = (id: string) => [...KEYS.all, 'detail', id] as const;

export function useBroadcastDetail(id: string) {
  return useQuery({
    queryKey: detailKey(id),
    queryFn: ({ signal }) =>
      apiFetch(`/broadcasts/${id}`, { schema: broadcastDetailSchema, signal }),
    retry: false,
  });
}

/** `enabled` is false until the detail is loaded, and the poll stops by itself when `inFlight` turns false. */
export function useBroadcastLive(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEYS.all, 'live', id],
    queryFn: ({ signal }) =>
      apiFetch(`/broadcasts/${id}/live`, { schema: broadcastLiveStatsSchema, signal }),
    enabled,
    refetchInterval: (q) => (q.state.data && !q.state.data.inFlight ? false : LIVE_POLL_MS),
  });
}

/** The recipients, filtered on the server, a page at a time. */
export function useBroadcastRecipients(id: string, filter: { status?: string; q?: string }) {
  return useCursorList(
    [...KEYS.all, 'recipients', id],
    `/broadcasts/${id}/recipients`,
    broadcastRecipientSchema,
    { status: filter.status || undefined, q: filter.q || undefined },
  );
}

export const retryFailed = (id: string) =>
  apiFetch(`/broadcasts/${id}/retry-failed`, {
    method: 'POST',
    schema: retryBroadcastResponseSchema,
  });

export const resumeBroadcast = (id: string) =>
  apiFetch(`/broadcasts/${id}/resume`, { method: 'POST', schema: resumeBroadcastResponseSchema });
