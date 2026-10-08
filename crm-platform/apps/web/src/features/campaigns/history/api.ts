'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  wizardBroadcastListSchema,
  wizardHistoryListSchema,
  type CampaignStatus,
  type WizardScheduleMode,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { BASE, STATUS_POLL_MS } from '../wizard/api/wizard';

/** What the three history pages ask the API for. Every key starts with `camp`, so a launch refreshes them all. */
export interface HistoryQuery {
  type: WizardScheduleMode | '';
  status: CampaignStatus | '';
  from: string;
  to: string;
  q: string;
  cursor: string | undefined;
}

export const PAGE_SIZE = 25;

/** Every broadcast that has run or is running, newest first. The page follows the worker while it is open. */
export function useBroadcastHistory(q: HistoryQuery, tz: string) {
  return useQuery({
    queryKey: ['camp', 'history', 'runs', q, tz] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/history`, {
        query: { ...q, scope: 'history', tz, limit: PAGE_SIZE },
        schema: wizardHistoryListSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: STATUS_POLL_MS,
    retry: false,
  });
}

/** Broadcasts waiting for their time, soonest first. */
export function useScheduledBroadcasts(q: { q: string; cursor: string | undefined }) {
  return useQuery({
    queryKey: ['camp', 'history', 'scheduled', q] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/history`, {
        query: { ...q, scope: 'scheduled', limit: PAGE_SIZE },
        schema: wizardHistoryListSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: STATUS_POLL_MS,
    retry: false,
  });
}

/** The recurring series, newest first. Their runs come with the series' own detail (`useBroadcast`). */
export function useRecurringBroadcasts(q: {
  q: string;
  status: string;
  cursor: string | undefined;
}) {
  return useQuery({
    queryKey: ['camp', 'history', 'series', q] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/broadcasts`, {
        query: { ...q, type: 'recurring', limit: PAGE_SIZE },
        schema: wizardBroadcastListSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: STATUS_POLL_MS,
    retry: false,
  });
}
