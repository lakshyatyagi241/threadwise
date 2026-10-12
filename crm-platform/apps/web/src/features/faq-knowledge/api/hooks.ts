'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type QueryClient,
} from '@tanstack/react-query';
import type { FaqEntry, FaqEntryListResponse } from '@crm/contracts';
import { flowsApi } from '@/features/flow-builder-editor/api/flows';
import { toListQuery, type ListFilters } from '../lib/list-model';
import type { LogView } from '../lib/log-model';
import { faqApi } from './service';

export const KEYS = {
  all: ['faq'] as const,
  list: ['faq', 'list'] as const,
  entry: (id: string) => ['faq', 'entry', id] as const,
  settings: ['faq', 'settings'] as const,
  summary: (days: number) => ['faq', 'summary', days] as const,
  summaries: ['faq', 'summary'] as const,
  log: ['faq', 'log'] as const,
  flows: (q: string) => ['faq', 'flows', q] as const,
  flowNodes: (flowId: string) => ['faq', 'flow-nodes', flowId] as const,
};

/** After any change to FAQs or their variations: lists, counts, the open entry and the unanswered badge are stale. */
export const refreshFaqs = (qc: QueryClient) => qc.invalidateQueries({ queryKey: KEYS.all });

/** The list screen: cursor pages with "Load more"; the stats of the newest loaded page describe the whole workspace. */
export function useFaqList(filters: ListFilters, debouncedSearch: string, enabled: boolean) {
  const query = toListQuery(filters, debouncedSearch);
  const q = useInfiniteQuery({
    queryKey: [...KEYS.list, query],
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      faqApi.list({ ...query, limit: 20, cursor: pageParam }, signal),
    getNextPageParam: (last: FaqEntryListResponse) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  const pages = q.data?.pages ?? [];
  return {
    ...q,
    items: pages.flatMap((p) => p.data),
    stats: pages[0]?.stats,
  };
}

export function useFaqEntry(id: string | null) {
  return useQuery<FaqEntry>({
    queryKey: KEYS.entry(id ?? ''),
    enabled: id !== null,
    retry: false,
    // While a variation is still being indexed the screen polls so the pending spinner turns into a check by itself.
    refetchInterval: (query) => {
      const e = query.state.data;
      return e && e.variations.some((v) => v.embedState === 'pending') ? 4000 : false;
    },
    queryFn: ({ signal }) => faqApi.get(id!, signal),
  });
}

/** Settings are readable with `faq.entries.read`; the banner and the editor counters use them on every screen. */
export function useFaqSettings(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.settings,
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) => faqApi.settings(signal),
  });
}

export function useFaqSummary(days: number, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.summary(days),
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) => faqApi.summary(days, signal),
  });
}

export function useFaqLog(view: LogView, search: string, enabled: boolean) {
  const q = useInfiniteQuery({
    queryKey: [...KEYS.log, view, search],
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      faqApi.log({ view, search: search || undefined, limit: 30, cursor: pageParam }, signal),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.data) ?? [] };
}

/** The flow picker's feed: the workspace's flows (needs `flb.flows.read`; without it the picker explains and offers nothing). */
export function useFlowOptions(search: string, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.flows(search),
    enabled,
    retry: false,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      flowsApi.list({ q: search || undefined, limit: 50, status: 'all', category: 'all' }, signal),
  });
}

/** The steps of the chosen flow, for the "Start at" select. Re-read when the screen regains focus: the flow may have been edited meanwhile. */
export function useFlowNodes(flowId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.flowNodes(flowId ?? ''),
    enabled: enabled && flowId !== null,
    retry: false,
    staleTime: 15_000,
    queryFn: ({ signal }) => faqApi.flowNodes(flowId!, signal),
  });
}

/** Categories already in use, for the editor's suggestions (the list response carries them in its stats). */
export function useFaqCategories(enabled: boolean) {
  return useQuery({
    queryKey: [...KEYS.list, 'categories'],
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) => faqApi.list({ limit: 1 }, signal).then((r) => r.stats.categories),
  });
}
