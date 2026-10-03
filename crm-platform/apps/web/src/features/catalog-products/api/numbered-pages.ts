'use client';

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import type { PageInfo } from '@crm/contracts';
import type { z } from 'zod';
import { apiFetch } from '@/lib/api/client';

type Query = Record<string, string | number | boolean | undefined>;
type Envelope = { data: unknown[]; page: PageInfo };

interface PageResult<R extends Envelope> {
  response: R;
  /** The 0-based index this page really is: a jump past the end lands on the last page. */
  index: number;
}

const pageKey = (key: readonly unknown[], q: Query, index: number) => [...key, q, index] as const;

/**
 * Loads page `index` (0-based) of a cursor API. The cursor of page N is the `nextCursor` of page N-1, so every loaded page is
 * cached under its own key and a call starts from the nearest cached page before the target.
 */
async function loadPage<R extends Envelope>(
  qc: QueryClient,
  key: readonly unknown[],
  path: string,
  schema: z.ZodType<R>,
  q: Query,
  index: number,
  signal?: AbortSignal,
): Promise<PageResult<R>> {
  let at = index;
  let cursor: string | undefined;
  for (; at > 0; at--) {
    const next = qc.getQueryData<PageResult<R>>(pageKey(key, q, at - 1))?.response.page;
    if (next?.hasMore && next.nextCursor) {
      cursor = next.nextCursor;
      break;
    }
  }
  for (;;) {
    const response = await apiFetch(path, { query: { ...q, cursor }, schema, signal });
    const result = { response, index: at };
    qc.setQueryData(pageKey(key, q, at), result);
    if (at >= index || !response.page.hasMore || !response.page.nextCursor) return result;
    cursor = response.page.nextCursor;
    at++;
  }
}

export interface NumberedPageOptions<R extends Envelope> {
  key: readonly unknown[];
  path: string;
  schema: z.ZodType<R>;
  /** The filter and the page size; the cursor is added here. */
  query: Query;
  /** 1-based. */
  page: number;
}

/** One numbered page of a cursor API; the next page is fetched ahead so "next" is instant. */
export function useNumberedPage<R extends Envelope>(o: NumberedPageOptions<R>) {
  const qc = useQueryClient();
  const index = Math.max(0, o.page - 1);
  const res = useQuery({
    queryKey: pageKey(o.key, o.query, index),
    queryFn: ({ signal }) => loadPage(qc, o.key, o.path, o.schema, o.query, index, signal),
    placeholderData: keepPreviousData,
    // a failed page shows its error and Retry at once instead of a spinner through three silent retries
    retry: false,
  });
  const hasMore = res.data?.response.page.hasMore ?? false;
  const identity = JSON.stringify(o.query);
  useEffect(() => {
    if (!hasMore || res.isPlaceholderData) return;
    void qc.prefetchQuery({
      queryKey: pageKey(o.key, o.query, index + 1),
      queryFn: ({ signal }) => loadPage(qc, o.key, o.path, o.schema, o.query, index + 1, signal),
    });
    // `o.query` is rebuilt every render; its serialisation is the stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, res.isPlaceholderData, index, identity, qc]);
  return {
    ...res,
    items: (res.data?.response.data ?? []) as R['data'],
    meta: (res.data?.response as { meta?: unknown } | undefined)?.meta,
    page: res.data ? res.data.index + 1 : o.page,
  };
}
