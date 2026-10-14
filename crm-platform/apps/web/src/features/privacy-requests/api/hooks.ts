'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { privacyApi, type RequestFilters } from './service';

export const KEYS = {
  all: ['privacy-requests'] as const,
  list: (f: RequestFilters) => ['privacy-requests', 'list', f] as const,
  detail: (id: string) => ['privacy-requests', 'detail', id] as const,
  settings: ['privacy-requests', 'settings'] as const,
  subjects: (q: string) => ['privacy-requests', 'subjects', q] as const,
};

/** The request list, newest first, a page at a time ("load more"). */
export function usePrivacyRequests(filters: RequestFilters, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: KEYS.list(filters),
    enabled,
    retry: false,
    staleTime: 10_000,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => privacyApi.list(filters, pageParam, signal),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
}

/** One request with its timeline and exports. Polls while an export is being built. */
export function usePrivacyRequest(id: string, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.detail(id),
    enabled,
    retry: false,
    queryFn: ({ signal }) => privacyApi.detail(id, signal),
    refetchInterval: (q) =>
      q.state.data?.exports.some((e) => e.status === 'queued' || e.status === 'running')
        ? 4_000
        : false,
  });
}

export function usePrivacySettings(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.settings,
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) => privacyApi.settings(signal),
  });
}

/** Finds a person by name, phone or email once at least two characters are typed. */
export function useSubjectSearch(q: string, enabled: boolean) {
  const term = q.trim();
  return useQuery({
    queryKey: KEYS.subjects(term),
    enabled: enabled && term.length >= 2,
    retry: false,
    staleTime: 15_000,
    queryFn: ({ signal }) => privacyApi.searchSubjects(term, signal),
  });
}
