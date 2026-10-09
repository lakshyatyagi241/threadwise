'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  DEFAULT_PAGE_SIZE,
  pageToFallBackTo,
  parseLimit,
  parsePage,
  type PageSize,
} from '../lib/pagination';

/** The page and the page size of a numbered list, wherever they are kept (the URL, or the component for a drawer). */
export interface Paging {
  page: number;
  limit: PageSize;
  /** Another page. `replace` swaps the history entry instead of adding one (corrections, filter changes). */
  setPage: (page: number, opts?: { replace?: boolean }) => void;
  /** Another page size: back to the first page. */
  setLimit: (limit: PageSize) => void;
}

/**
 * Page and size in the query string (`?page=2&limit=50`), so a refresh and the back button land where the person was. Defaults are
 * left out of the URL. Needs a Suspense boundary above it (it reads the search params).
 */
export function useUrlPaging(): Paging {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = parsePage(params.get('page'));
  const limit = parseLimit(params.get('limit'));

  const write = (next: { page: number; limit: PageSize }, replace: boolean) => {
    const p = new URLSearchParams(params.toString());
    if (next.page > 1) p.set('page', String(next.page));
    else p.delete('page');
    if (next.limit !== DEFAULT_PAGE_SIZE) p.set('limit', String(next.limit));
    else p.delete('limit');
    const qs = p.toString();
    const href = qs === '' ? pathname : `${pathname}?${qs}`;
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  };

  return {
    page,
    limit,
    setPage: (n, opts) => write({ page: Math.max(1, n), limit }, opts?.replace ?? false),
    setLimit: (l) => write({ page: 1, limit: l }, false),
  };
}

/** Page and size kept in the component (the logs drawer of a list row, which has no URL of its own). */
export function useLocalPaging(): Paging {
  const [state, setState] = useState<{ page: number; limit: PageSize }>({
    page: 1,
    limit: DEFAULT_PAGE_SIZE,
  });
  return {
    ...state,
    setPage: (n) => setState((s) => ({ ...s, page: Math.max(1, n) })),
    setLimit: (l) => setState({ page: 1, limit: l }),
  };
}

/**
 * A page past the end (a filter narrowed the list, rows were deleted, a stale link) is an empty table: go to the last real page
 * instead. Waits for a real answer, not the previous page kept on screen while the next loads.
 */
export function useFallBackToLastPage(
  paging: Paging,
  answer: { totalPages: number } | undefined,
  settled: boolean,
) {
  const { page, setPage } = paging;
  const target = settled && answer ? pageToFallBackTo(page, answer.totalPages) : null;
  useEffect(() => {
    if (target !== null) setPage(target, { replace: true });
    // `setPage` is a new function every render; the page it is asked for is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
}
