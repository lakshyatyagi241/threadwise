'use client';

import { useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query';
import {
  contactGroupResponseSchema,
  contactResponseSchema,
  enrollResultSchema,
  flowAnalyticsSchema,
  flowRunDetailSchema,
  flowRunListSchema,
  flowSubscriberListSchema,
  pageResponseSchema,
  retryResultSchema,
  type EnrollContactsInput,
  type FlowSubscriberStatus,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import {
  SUBSCRIBERS_PAGE_SIZE,
  flattenPages,
  nextCursor,
  runsQuery,
  type RunsState,
} from '../lib/model';

const BASE = '/flow-runtime';

export const KEYS = {
  all: ['flr'] as const,
  runs: ['flr', 'runs'] as const,
  subscribers: ['flr', 'subscribers'] as const,
  analytics: ['flr', 'analytics'] as const,
};

/** A live run moves on the worker (waits end, delays count down), so the lists follow along while the tab is visible. */
export const POLL_MS = 15_000;

export const refreshAll = (qc: QueryClient) => qc.invalidateQueries({ queryKey: KEYS.all });

export function useRuns(state: RunsState) {
  const q = useInfiniteQuery({
    queryKey: [...KEYS.runs, 'list', state],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(`${BASE}/runs`, {
        query: runsQuery(state, pageParam),
        schema: flowRunListSchema,
        signal,
      }),
    getNextPageParam: (last) => nextCursor(last),
    refetchInterval: POLL_MS,
  });
  return { ...q, items: flattenPages(q.data?.pages ?? []) };
}

export function useRun(id: string) {
  return useQuery({
    queryKey: [...KEYS.runs, 'detail', id],
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/runs/${id}`, { schema: flowRunDetailSchema, signal }),
    // A run that is over does not change; a live one does.
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'running' || s === 'waiting' || s === 'sleeping' || s === 'halted'
        ? POLL_MS
        : false;
    },
    retry: (count, error) => (error as { status?: number }).status !== 404 && count < 2,
  });
}

export const cancelRun = (id: string) => apiFetch(`${BASE}/runs/${id}/cancel`, { method: 'POST' });

export function useSubscribers(flowId: string, status: FlowSubscriberStatus | 'all') {
  const q = useInfiniteQuery({
    queryKey: [...KEYS.subscribers, flowId, status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(`${BASE}/flows/${flowId}/subscribers`, {
        query: {
          status: status === 'all' ? undefined : status,
          limit: SUBSCRIBERS_PAGE_SIZE,
          cursor: pageParam,
        },
        schema: flowSubscriberListSchema,
        signal,
      }),
    getNextPageParam: (last) => nextCursor(last),
    refetchInterval: POLL_MS,
    retry: (count, error) => (error as { status?: number }).status !== 404 && count < 2,
  });
  return {
    ...q,
    items: flattenPages(q.data?.pages ?? []),
    // The counts cover every subscriber; the first page's are the freshest because it is refetched with the rest.
    counts: q.data?.pages[0]?.counts,
  };
}

export const pauseSubscriber = (id: string) =>
  apiFetch(`${BASE}/subscribers/${id}/pause`, { method: 'POST' });
export const resumeSubscriber = (id: string) =>
  apiFetch(`${BASE}/subscribers/${id}/resume`, { method: 'POST' });
export const retrySubscriber = (id: string) =>
  apiFetch(`${BASE}/subscribers/${id}/retry`, { method: 'POST' });
export const retryFailed = (flowId: string) =>
  apiFetch(`${BASE}/flows/${flowId}/retry-failed`, { method: 'POST', schema: retryResultSchema });
export const enrollContacts = (flowId: string, body: EnrollContactsInput) =>
  apiFetch(`${BASE}/flows/${flowId}/enroll`, { method: 'POST', body, schema: enrollResultSchema });

export function useAnalytics(days: number, flowId: string) {
  return useQuery({
    queryKey: [...KEYS.analytics, days, flowId],
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/analytics`, {
        query: { days, flowId: flowId || undefined },
        schema: flowAnalyticsSchema,
        signal,
      }),
    refetchInterval: POLL_MS,
  });
}

/**
 * Flows to pick from in the runs filter and the analytics scope. There is no session-authenticated "list flows" endpoint yet (the
 * editor is not ported; `/public/v1/flows` takes an API key), so these are the flows that have runs in the last 180 days.
 */
export function useFlowOptions() {
  return useQuery({
    queryKey: [...KEYS.analytics, 'flow-options'],
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/analytics`, { query: { days: 180 }, schema: flowAnalyticsSchema, signal }),
    select: (a) => a.leaderboard.map((f) => ({ id: f.flowId, name: f.flowName })),
    staleTime: 60_000,
  });
}

export const startFlowOnConversation = (conversationId: string, flowId: string) =>
  apiFetch<{ runId: string }>(`${BASE}/conversations/${conversationId}/start`, {
    method: 'POST',
    body: { flowId },
  });

// --- enrollment pickers (the contacts and groups endpoints other features use) ---------------------------------------------

export const PICKER_LIMIT = 100;

export function useContactSearch(q: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEYS.all, 'contact-search', q],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch('/contacts', {
        query: { limit: PICKER_LIMIT, order: 'desc', q: q || undefined },
        schema: pageResponseSchema(contactResponseSchema),
        signal,
      }),
    placeholderData: (prev) => prev,
  });
}

export function useContactGroups(enabled: boolean) {
  return useQuery({
    queryKey: [...KEYS.all, 'groups'],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch('/contact-groups', {
        query: { limit: 200 },
        schema: pageResponseSchema(contactGroupResponseSchema),
        signal,
      }),
  });
}
