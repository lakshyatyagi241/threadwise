'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { crmDashboardApi } from './service';

/** A short freshness window: the numbers are live aggregates, so a revisit within half a minute reuses them and a filter change refetches. */
export function useCrmDashboard(query: Record<string, string | undefined>) {
  return useQuery({
    queryKey: ['crm-dashboard', query],
    queryFn: ({ signal }) => crmDashboardApi.dashboard(query, signal),
    staleTime: 30_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

/** Pickers. A caller who may not list members or teams still sees the dashboard; the picker is then just empty. */
export function usePipelineOptions() {
  return useQuery({
    queryKey: ['crm-dashboard', 'pipelines'],
    queryFn: ({ signal }) => crmDashboardApi.pipelines(signal),
    staleTime: 60_000,
    retry: false,
  });
}
export function useMemberOptions() {
  return useQuery({
    queryKey: ['crm-dashboard', 'members'],
    queryFn: ({ signal }) => crmDashboardApi.members(signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
export function useTeamOptions() {
  return useQuery({
    queryKey: ['crm-dashboard', 'teams'],
    queryFn: ({ signal }) => crmDashboardApi.teams(signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
