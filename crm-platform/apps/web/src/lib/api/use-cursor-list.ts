'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { pageResponseSchema } from '@crm/contracts';
import type { z } from 'zod';
import { apiFetch } from './client';

/** "Load more" list over the API's cursor envelope. There is no page number and no total. */
export function useCursorList<T>(
  key: readonly unknown[],
  path: string,
  item: z.ZodType<T>,
  query: Record<string, string | number | boolean | undefined> = {},
  retry?: { retry: number; retryDelay: number },
) {
  const schema = pageResponseSchema(item);
  const q = useInfiniteQuery({
    queryKey: [...key, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(path, { query: { limit: 50, ...query, cursor: pageParam }, schema, signal }),
    ...retry,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.data) ?? [] };
}
