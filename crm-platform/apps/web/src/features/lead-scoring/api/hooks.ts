'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LscRunStatus,
  LscRunsResponse,
  LscSuggestionDecisionInput,
  LscSuggestionsResponse,
} from '@crm/contracts';
import { lscApi } from './service';

export const KEYS = {
  all: ['lead-scoring'] as const,
  settings: ['lead-scoring', 'settings'] as const,
  status: ['lead-scoring', 'status'] as const,
  runs: ['lead-scoring', 'runs'] as const,
  insight: (contactId: string) => ['lead-scoring', 'insight', contactId] as const,
  suggestions: ['lead-scoring', 'suggestions'] as const,
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

/**
 * Whether the workspace has switched AI lead scoring on (`GET /lead-scoring/status`, open to everyone who reads contacts). `enabled` is
 * the plan side: without the feature the route is refused, so it is not asked. The settings screen refreshes it when the switch is saved.
 */
export function useLscStatus(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.status,
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) => lscApi.status(signal),
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

/** The reading of a contact's conversation. `enabled` is the right to read the log; the answer says whether the reading is active. */
export function useLscInsight(contactId: string, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.insight(contactId),
    enabled,
    retry: false,
    staleTime: 15_000,
    queryFn: ({ signal }) => lscApi.insight(contactId, signal),
  });
}

/** Reads the contact's conversation now. Afterwards the log, the counts and the suggestions are stale. */
export function useDigestContact(contactId: string, onRead?: () => void | Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => lscApi.digest(contactId),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS.all }),
    onSuccess: async (fresh) => {
      qc.setQueryData(KEYS.insight(contactId), fresh);
      await onRead?.();
    },
  });
}

export const SUGGESTIONS_PAGE_SIZE = 25;

/** The stage suggestions waiting for a decision, in cursor pages. */
export function useLscSuggestions(enabled: boolean, limit = SUGGESTIONS_PAGE_SIZE) {
  const q = useInfiniteQuery({
    queryKey: [...KEYS.suggestions, limit],
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      lscApi.suggestions({ status: 'pending', limit, cursor: pageParam }, signal),
    getNextPageParam: (last: LscSuggestionsResponse) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.data) ?? [] };
}

/**
 * Accepts or dismisses suggestions. Accepting changes contacts, so `onDecided` lets the caller refresh them (this feature does not
 * know the contacts screens' query keys).
 */
export function useDecideSuggestions(onDecided?: () => void | Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LscSuggestionDecisionInput) => lscApi.decide(input),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS.all }),
    onSuccess: async () => {
      await onDecided?.();
    },
  });
}
