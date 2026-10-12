'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LscRunStatus, LscRunsResponse } from '@crm/contracts';
import { lscApi } from './service';

export const KEYS = {
  all: ['lead-scoring'] as const,
  settings: ['lead-scoring', 'settings'] as const,
  runs: ['lead-scoring', 'runs'] as const,
};

export const RUNS_PAGE_SIZE = 25;

export function useLscSettings(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.settings,
    enabled,
    retry: false,
    staleTime: 15_000,
    queryFn: ({ signal }) => lscApi.settings(signal),
  });
}

export interface RunsFilter {
  status?: LscRunStatus;
  contactId?: string;
}

/** The scoring log in cursor pages; `contactId` narrows it to one contact (the history on the contact page). */
export function useLscRuns(filter: RunsFilter, enabled: boolean, limit = RUNS_PAGE_SIZE) {
  const q = useInfiniteQuery({
    queryKey: [...KEYS.runs, filter, limit],
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      lscApi.runs({ ...filter, limit, cursor: pageParam }, signal),
    getNextPageParam: (last: LscRunsResponse) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.data) ?? [] };
}

/**
 * Scores one contact now. Afterwards the log, the counts and the 30 day cost are stale; `onScored` lets the caller refresh the
 * contact itself (this feature does not know the contacts screens' query keys).
 */
export function useScoreContact(contactId: string, onScored?: () => void | Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => lscApi.score(contactId),
    // A failed attempt is logged too ("failed", "skipped"), so the log is stale either way.
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS.all }),
    onSuccess: async () => {
      await onScored?.();
    },
  });
}

export function useBackfill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (limit: number) => lscApi.backfill(limit),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}
