'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type QueryClient,
} from '@tanstack/react-query';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { dealsApi } from './service';
import type { Member } from './schemas';

export const KEYS = {
  pipelines: ['deals', 'pipelines'] as const,
  members: ['deals', 'members'] as const,
  deal: (id: string) => ['deals', 'deal', id] as const,
  activities: (id: string) => ['deals', 'activities', id] as const,
  list: ['deals', 'list'] as const,
  report: ['deals', 'report'] as const,
  settings: ['deals', 'settings'] as const,
  lostReasons: ['deals', 'lost-reasons'] as const,
  board: ['deals', 'board'] as const,
};

export function usePipelines() {
  return useQuery({
    queryKey: KEYS.pipelines,
    queryFn: ({ signal }) => dealsApi.pipelines(signal),
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * Workspace members for the owner pickers. Listing staff needs a permission not every role has, so when the call is
 * refused the picker still offers the signed-in person.
 */
export function useMembers() {
  const session = useSession();
  return useQuery({
    queryKey: KEYS.members,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }): Promise<Member[]> => {
      try {
        const rows = await dealsApi.members(signal);
        if (rows.length > 0) return rows;
      } catch {
        /* falls through to the signed-in person */
      }
      return [{ id: session.user.id, fullName: session.user.displayName ?? session.user.fullName }];
    },
  });
}

export function useDealDetail(id: string | null, currency?: string) {
  return useQuery({
    queryKey: KEYS.deal(id ?? ''),
    queryFn: ({ signal }) => dealsApi.deal(id!, currency, signal),
    enabled: id !== null,
    retry: false,
  });
}

export function useActivities(dealId: string | null) {
  return useQuery({
    queryKey: KEYS.activities(dealId ?? ''),
    queryFn: ({ signal }) => dealsApi.activities(dealId!, signal),
    enabled: dealId !== null,
    retry: false,
  });
}

export interface ReportParams {
  pipelineId: string;
  from: string;
  to: string;
  currency: string;
}

export function useReport(p: ReportParams) {
  return useQuery({
    queryKey: [...KEYS.report, p],
    queryFn: ({ signal }) =>
      dealsApi.report(
        { pipelineId: p.pipelineId || undefined, from: p.from || undefined, to: p.to || undefined },
        p.currency,
        signal,
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useDealSettings() {
  return useQuery({
    queryKey: KEYS.settings,
    queryFn: ({ signal }) => dealsApi.settings(signal),
    retry: false,
  });
}

/** The lost-reason catalogue. `activeOnly` is what a picker offers; the settings screen lists them all. */
export function useLostReasons(activeOnly: boolean) {
  return useQuery({
    queryKey: [...KEYS.lostReasons, activeOnly],
    queryFn: ({ signal }) => dealsApi.lostReasons(activeOnly, signal),
    retry: false,
    staleTime: 60_000,
  });
}

/** The table view: every deal of the pipeline that passes the filters, "load more" by cursor. */
export function useDealsList(query: Record<string, string | undefined>) {
  const q = useInfiniteQuery({
    queryKey: [...KEYS.list, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      dealsApi.deals({ limit: 25, ...query, cursor: pageParam }, signal),
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    retry: false,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.deals) ?? [] };
}

export function invalidateDeals(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: KEYS.list }),
    qc.invalidateQueries({ queryKey: KEYS.report }),
    qc.invalidateQueries({ queryKey: KEYS.pipelines }),
  ]);
}
