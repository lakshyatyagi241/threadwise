'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuditLogFilters } from '@crm/contracts';
import { auditLogApi } from './service';

export const AUDIT_KEYS = {
  all: ['audit-log'] as const,
  list: (f: AuditLogFilters, tick: number) => ['audit-log', 'list', f, tick] as const,
  detail: (id: string) => ['audit-log', 'detail', id] as const,
  facets: (f: Pick<AuditLogFilters, 'from' | 'to'>) => ['audit-log', 'facets', f] as const,
  settings: ['audit-log', 'settings'] as const,
  exports: ['audit-log', 'exports'] as const,
};

/** The entries for the filters, a page of 50 at a time (a cursor, never an offset). `tick` re-reads on "Refresh". */
export function useAuditEntries(filters: AuditLogFilters, tick: number, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: AUDIT_KEYS.list(filters, tick),
    enabled,
    retry: false,
    staleTime: 30_000,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => auditLogApi.list(filters, pageParam, signal),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
}

/** One entry with its masked changes. Opening it writes the server's `read` audit row, so it is fetched once per open. */
export function useAuditEntry(id: string) {
  return useQuery({
    queryKey: AUDIT_KEYS.detail(id),
    enabled: id !== '',
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: ({ signal }) => auditLogApi.detail(id, signal),
  });
}

export function useAuditFacets(range: Pick<AuditLogFilters, 'from' | 'to'>, enabled: boolean) {
  return useQuery({
    queryKey: AUDIT_KEYS.facets(range),
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) => auditLogApi.facets(range, signal),
  });
}

export function useAuditSettings(enabled: boolean) {
  return useQuery({
    queryKey: AUDIT_KEYS.settings,
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => auditLogApi.settings(signal),
  });
}

/** The prepared exports. Polls while one is being built. */
export function useAuditExports(enabled: boolean) {
  return useQuery({
    queryKey: AUDIT_KEYS.exports,
    enabled,
    retry: false,
    staleTime: 5_000,
    queryFn: ({ signal }) => auditLogApi.exports(signal),
    refetchInterval: (q) =>
      q.state.data?.data.some((e) => e.status === 'queued' || e.status === 'running')
        ? 5_000
        : false,
  });
}

export function useRequestExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (filters: AuditLogFilters) => auditLogApi.requestExport(filters),
    onSettled: () => qc.invalidateQueries({ queryKey: AUDIT_KEYS.exports }),
  });
}
