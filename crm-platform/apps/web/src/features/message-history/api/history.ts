'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  channelListResponseSchema,
  messageHistoryDetailSchema,
  messageHistoryInsightsSchema,
  messageHistoryPageSchema,
  messageHistorySummarySchema,
  messageLogExportListSchema,
  messageLogExportSchema,
  type MessageLogExport,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import { transientRetry, transientRetryDelay } from '@/lib/api/retry';
import {
  exportBody,
  feedQuery,
  insightsQuery,
  summaryQuery,
  type HistoryState,
} from '../lib/filters';

export const PAGE = 25;

export const KEYS = {
  all: ['message-history'] as const,
  list: (q: unknown) => ['message-history', 'list', q] as const,
  summary: (q: unknown) => ['message-history', 'summary', q] as const,
  insights: (q: unknown) => ['message-history', 'insights', q] as const,
  detail: (id: string) => ['message-history', 'detail', id] as const,
  exports: ['message-history', 'exports'] as const,
  channels: ['message-history', 'channels'] as const,
};

/** Every Message History call. The proxy adds the session token. */
export const historyApi = {
  page: (s: HistoryState, cursor: string | null, signal?: AbortSignal) =>
    apiFetch('/message-history', {
      query: { ...feedQuery(s), limit: PAGE, cursor: cursor ?? undefined },
      schema: messageHistoryPageSchema,
      signal,
    }),
  summary: (s: HistoryState, signal?: AbortSignal) =>
    apiFetch('/message-history/summary', {
      query: summaryQuery(s),
      schema: messageHistorySummarySchema,
      signal,
    }),
  insights: (s: HistoryState, tz: string, signal?: AbortSignal) =>
    apiFetch('/message-history/insights', {
      query: insightsQuery(s, tz),
      schema: messageHistoryInsightsSchema,
      signal,
    }),
  detail: (id: string, signal?: AbortSignal) =>
    apiFetch(`/message-history/${encodeURIComponent(id)}`, {
      schema: messageHistoryDetailSchema,
      signal,
    }),
  exports: (signal?: AbortSignal) =>
    apiFetch('/inbox/message-logs/exports', {
      query: { kind: 'messages' },
      schema: messageLogExportListSchema,
      signal,
    }),
  requestExport: (s: HistoryState) =>
    apiFetch('/message-history/exports', {
      method: 'POST',
      body: exportBody(s),
      schema: messageLogExportSchema,
    }),
};

/** The finished export as a file (it needs the session, so it is fetched and the body handed to the browser). */
export async function downloadHistoryExport(
  exportId: string,
): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetch(`/api/v2/inbox/message-logs/exports/${exportId}/download`, {
    headers: { Accept: 'text/csv', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw toApiError(res.status, body, res.headers.get('x-request-id'));
  }
  const m = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '');
  return { blob: await res.blob(), fileName: m?.[1] ?? 'message-history.csv' };
}

const retry = { retry: transientRetry, retryDelay: transientRetryDelay } as const;

/** The table: pages of 25 by cursor, one more on "Load more". A filter change starts again from the newest. */
export function useHistoryFeed(s: HistoryState) {
  const key = feedQuery(s);
  return useInfiniteQuery({
    queryKey: KEYS.list(key),
    queryFn: ({ pageParam, signal }) => historyApi.page(s, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page.nextCursor,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    ...retry,
  });
}

export function useHistorySummary(s: HistoryState) {
  return useQuery({
    queryKey: KEYS.summary(summaryQuery(s)),
    queryFn: ({ signal }) => historyApi.summary(s, signal),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    ...retry,
  });
}

export function useHistoryInsights(s: HistoryState, tz: string) {
  return useQuery({
    queryKey: KEYS.insights(insightsQuery(s, tz)),
    queryFn: ({ signal }) => historyApi.insights(s, tz, signal),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    ...retry,
  });
}

/** One row for the drawer; read again on every open (a receipt may have arrived). */
export function useHistoryDetail(id: string) {
  return useQuery({
    queryKey: KEYS.detail(id),
    queryFn: ({ signal }) => historyApi.detail(id, signal),
    enabled: id !== '',
    staleTime: 0,
    ...retry,
  });
}

const ACTIVE = new Set<MessageLogExport['status']>(['queued', 'running']);

/** The workspace's latest history exports. While one is being prepared the list is read every few seconds. */
export function useHistoryExports(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.exports,
    queryFn: ({ signal }) => historyApi.exports(signal),
    enabled,
    staleTime: 5_000,
    refetchInterval: (q) => (q.state.data?.data.some((e) => ACTIVE.has(e.status)) ? 4_000 : false),
    ...retry,
  });
}

export function useRequestHistoryExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: HistoryState) => historyApi.requestExport(s),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS.exports }),
  });
}

/** The connected channels for the channel filter. A caller who may not list them simply gets no select (the error is not shown). */
export function useChannelOptions() {
  return useQuery({
    queryKey: KEYS.channels,
    queryFn: ({ signal }) => apiFetch('/channels', { schema: channelListResponseSchema, signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
