'use client';

import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ListFlowsResponse } from '@crm/contracts';
import { PAGE_SIZE, type ListState } from '../lib/list-model';
import { flowsApi } from './flows';
import { FLB_KEYS } from './hooks';

const query = (s: ListState) => ({
  status: s.status === 'all' ? undefined : s.status,
  category: s.category === 'all' ? undefined : s.category,
  q: s.q || undefined,
  limit: PAGE_SIZE,
  includeTotal: true,
});
type Query = ReturnType<typeof query>;

interface PageResult {
  response: ListFlowsResponse;
  /** The 0-based index this page really is: a jump past the end lands on the last page. */
  index: number;
}

const pageKey = (q: Query, index: number) => [...FLB_KEYS.list, q, index] as const;

/**
 * Loads page `index` (0-based) of the cursor API. The cursor of page N is the `nextCursor` of page N-1, so every loaded page
 * is cached under its own key and a jump starts from the nearest cached page before the target.
 */
async function loadPage(qc: QueryClient, q: Query, index: number, signal?: AbortSignal): Promise<PageResult> {
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
    const response = await flowsApi.list({ ...q, cursor }, signal);
    const result = { response, index: at };
    qc.setQueryData(pageKey(q, at), result);
    if (at >= index || !response.page.hasMore || !response.page.nextCursor) return result;
    cursor = response.page.nextCursor;
    at++;
  }
}

/** One numbered page (`state.page` is 1-based) with the total of the filter; the next page is fetched ahead. */
export function useFlowsPage(state: ListState) {
  const qc = useQueryClient();
  const q = query(state);
  const index = Math.max(0, state.page - 1);
  const res = useQuery({
    queryKey: pageKey(q, index),
    queryFn: ({ signal }) => loadPage(qc, q, index, signal),
    placeholderData: keepPreviousData,
    // WaDesk toasts a failed refresh at once ("Could not refresh"); the shared two retries would show it only after seconds.
    retry: false,
  });
  const hasMore = res.data?.response.page.hasMore ?? false;
  const identity = JSON.stringify(q);
  useEffect(() => {
    if (!hasMore || res.isPlaceholderData) return;
    void qc.prefetchQuery({ queryKey: pageKey(q, index + 1), queryFn: ({ signal }) => loadPage(qc, q, index + 1, signal) });
    // `q` is rebuilt every render; its serialisation is the stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, res.isPlaceholderData, index, identity, qc]);
  return {
    ...res,
    items: res.data?.response.data ?? [],
    page: res.data ? res.data.index + 1 : state.page,
    total: res.data?.response.total,
  };
}

/** KPI tiles, rails, the featured card and the template gallery: ignore the list filters. */
export function useFlowsOverview() {
  return useQuery({ queryKey: FLB_KEYS.overview, queryFn: ({ signal }) => flowsApi.overview(signal) });
}
