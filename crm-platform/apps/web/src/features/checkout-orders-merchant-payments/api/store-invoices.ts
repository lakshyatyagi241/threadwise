'use client';

import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { InvoiceStatus } from '@crm/contracts';
import { invoicingApi } from '@/features/invoicing/api/service';
import { CHK_KEYS } from './hooks';
import {
  PAGE_LIMIT,
  mergeStoreInvoices,
  shouldAutoFetch,
  stoppedAtCap,
} from '../lib/store-invoices';

export interface StoreInvoicesQuery {
  q?: string;
  status?: InvoiceStatus;
}

/**
 * The store's invoices: pages of the Sales invoice list (`GET /invoices`, newest first, 50 a page) narrowed to the ones created from
 * store orders (source `own`). The API has no source filter, so the narrowing is client-side: further pages are fetched by themselves
 * until a screenful is in hand, at most AUTO_PAGE_CAP per refresh; past that the screen offers Load more.
 */
export function useStoreInvoices(query: StoreInvoicesQuery, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const params = {
    limit: PAGE_LIMIT,
    q: query.q?.trim() || undefined,
    status: query.status,
  };
  const q = useInfiniteQuery({
    queryKey: [...CHK_KEYS.invoices, params],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => invoicingApi.list({ ...params, cursor: pageParam }, signal),
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const pages = q.data?.pages ?? [];
  const items = mergeStoreInvoices(pages.map((p) => p.items));
  const hasMore = q.hasNextPage;
  const wantsMore = shouldAutoFetch({ hasMore, kept: items.length, pagesFetched: pages.length });
  const { fetchNextPage, isFetching, isError } = q;

  useEffect(() => {
    if (enabled && wantsMore && !isFetching && !isError) void fetchNextPage();
  }, [enabled, wantsMore, isFetching, isError, fetchNextPage, pages.length]);

  return {
    items,
    isPending: q.isPending,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
    hasNextPage: hasMore,
    fetchNextPage: q.fetchNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
    /** Still looking for the first screenful (the automatic fetching has not finished). */
    searching: wantsMore || (q.isFetchingNextPage && items.length < 1),
    /** The automatic budget ran out while pages remain: some invoices may not have been looked through. */
    stoppedAtCap: stoppedAtCap({ hasMore, pagesFetched: pages.length }),
  };
}
