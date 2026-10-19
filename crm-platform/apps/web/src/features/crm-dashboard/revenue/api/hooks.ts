'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RequestRevenueExport } from '@crm/contracts';
import { revenueApi } from './service';

export const REVENUE_KEYS = {
  report: ['crm-revenue'] as const,
  exports: ['crm-revenue', 'exports'] as const,
};

/** A short freshness window: the numbers are live aggregates, so a revisit within half a minute reuses them and a filter change refetches. */
export function useRevenueReport(query: Record<string, string | undefined>) {
  return useQuery({
    queryKey: [...REVENUE_KEYS.report, 'report', query],
    queryFn: ({ signal }) => revenueApi.report(query, signal),
    staleTime: 30_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

/** The caller's prepared files. Polls while one is being built. */
export function useRevenueExports(enabled: boolean) {
  return useQuery({
    queryKey: REVENUE_KEYS.exports,
    enabled,
    queryFn: ({ signal }) => revenueApi.exports(signal),
    retry: false,
    refetchInterval: (q) =>
      q.state.data?.data.some((e) => e.status === 'queued' || e.status === 'running')
        ? 3_000
        : false,
  });
}

export function useRequestRevenueExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RequestRevenueExport) => revenueApi.requestExport(body),
    onSettled: () => qc.invalidateQueries({ queryKey: REVENUE_KEYS.exports }),
  });
}
