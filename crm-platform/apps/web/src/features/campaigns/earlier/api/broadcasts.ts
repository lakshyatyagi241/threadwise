'use client';

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  broadcastSummarySchema,
  listBroadcastsResponseSchema,
  type ListBroadcastsResponse,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import { PAGE_SIZE, type ListState } from '../lib/list-model';

export const KEYS = {
  all: ['bcast'] as const,
  list: ['bcast', 'list'] as const,
  summary: ['bcast', 'summary'] as const,
};

/** Broadcasts move through scheduled, processing and completed on the worker, so the list and the tiles follow along. */
export const POLL_MS = 15_000;

const query = (s: ListState) => ({
  status: s.status === 'all' ? undefined : s.status,
  range: s.range === 'all' ? undefined : s.range,
  q: s.q || undefined,
  limit: PAGE_SIZE,
  includeTotal: true,
});
type Query = ReturnType<typeof query>;

interface PageResult {
  response: ListBroadcastsResponse;
  /** The 0-based index this page really is: a jump past the end lands on the last page. */
  index: number;
}

const pageKey = (q: Query, index: number) => [...KEYS.list, q, index] as const;

/**
 * Loads page `index` (0-based) of a cursor API. The cursor of page N is the `nextCursor` of page N-1, so every loaded page
 * is cached under its own key and the next call starts from the nearest cached page before the target.
 */
async function loadPage(
  qc: QueryClient,
  q: Query,
  index: number,
  signal?: AbortSignal,
): Promise<PageResult> {
  let at = index;
  let cursor: string | undefined;
  for (; at > 0; at--) {
    const next = qc.getQueryData<PageResult>(pageKey(q, at - 1))?.response.page;
    if (next?.hasMore && next.nextCursor) {
      cursor = next.nextCursor;
      break;
    }
  }
  for (;;) {
    const response = await apiFetch('/broadcasts', {
      query: { ...q, cursor },
      schema: listBroadcastsResponseSchema,
      signal,
    });
    const result = { response, index: at };
    qc.setQueryData(pageKey(q, at), result);
    if (at >= index || !response.page.hasMore || !response.page.nextCursor) return result;
    cursor = response.page.nextCursor;
    at++;
  }
}

/** One numbered page (`state.page` is 1-based) with the total of the filter; the next page is fetched ahead. */
export function useBroadcastsPage(state: ListState) {
  const qc = useQueryClient();
  const q = query(state);
  const index = Math.max(0, state.page - 1);
  const res = useQuery({
    queryKey: pageKey(q, index),
    queryFn: ({ signal }) => loadPage(qc, q, index, signal),
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
    // The list polls anyway, so a failed read shows its error state at once instead of a spinner through the retries.
    retry: false,
  });
  const hasMore = res.data?.response.page.hasMore ?? false;
  const identity = JSON.stringify(q);
  useEffect(() => {
    if (!hasMore || res.isPlaceholderData) return;
    void qc.prefetchQuery({
      queryKey: pageKey(q, index + 1),
      queryFn: ({ signal }) => loadPage(qc, q, index + 1, signal),
    });
    // `q` is rebuilt every render; its serialisation is the stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, res.isPlaceholderData, index, identity, qc]);
  return {
    ...res,
    items: res.data?.response.data ?? [],
    page: res.data ? res.data.index + 1 : state.page,
    total: res.data?.response.meta?.total,
  };
}

/** The five newest broadcasts whatever the list's filter, for the rail. */
export function useRecentBroadcasts() {
  return useQuery({
    queryKey: [...KEYS.list, 'recent'],
    queryFn: ({ signal }) =>
      apiFetch('/broadcasts', {
        query: { limit: 5 },
        schema: listBroadcastsResponseSchema,
        signal,
      }),
    refetchInterval: POLL_MS,
  });
}

/** Workspace-wide tiles and status counts; they ignore the list's filter. */
export function useBroadcastSummary() {
  return useQuery({
    queryKey: KEYS.summary,
    queryFn: ({ signal }) =>
      apiFetch('/broadcasts/summary', { schema: broadcastSummarySchema, signal }),
    refetchInterval: POLL_MS,
  });
}

export async function deleteBroadcast(id: string): Promise<void> {
  await apiFetch(`/broadcasts/${id}`, { method: 'DELETE' });
}

/** The recipients as a CSV, for a download; the server names the file. */
export async function exportBroadcast(id: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`/api/v2/broadcasts/${id}/export`, {
    headers: { Accept: 'text/csv, application/json', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    throw toApiError(res.status, json, res.headers.get('x-request-id'));
  }
  const named = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  return { blob: await res.blob(), filename: named ?? `broadcast-${id}.csv` };
}
