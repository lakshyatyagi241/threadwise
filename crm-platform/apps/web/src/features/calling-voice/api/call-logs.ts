'use client';

import { useEffect, useRef } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  REALTIME_EVENT,
  callAnalyticsSchema,
  callLogDetailSchema,
  callLogFiltersSchema,
  callLogListSchema,
  callPlaybackSchema,
  type CallAnalyticsQuery,
  type CallLogListQuery,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { useRealtimeClient, useResync } from '@/lib/realtime';
import { callErrorKey } from '../lib/calls';

const BASE = '/calling/call-logs';

export const LOG_KEYS = {
  all: ['call', 'logs'] as const,
  list: (q: unknown) => ['call', 'logs', 'list', q] as const,
  filters: ['call', 'logs', 'filters'] as const,
  detail: (id: string) => ['call', 'logs', 'detail', id] as const,
  analytics: (q: unknown) => ['call', 'logs', 'analytics', q] as const,
};

/** A refusal that asking again cannot change: no permission, or a plan without calling. */
const refused = (e: unknown) =>
  callErrorKey(e) === 'FORBIDDEN' || callErrorKey(e) === 'PLAN_FEATURE_LOCKED';
const retryUnlessRefused = (count: number, e: unknown) => !refused(e) && count < 2;

export function useCallLogs(query: Partial<CallLogListQuery>) {
  return useQuery({
    queryKey: LOG_KEYS.list(query),
    queryFn: ({ signal }) =>
      apiFetch(BASE, {
        query: query as Record<string, string | number | undefined>,
        schema: callLogListSchema,
        signal,
      }),
    // Paging and filtering keep the last page on screen until the next one arrives, so the table does not flash empty.
    placeholderData: keepPreviousData,
    retry: retryUnlessRefused,
  });
}

/** The numbers and teammates for the filter bar. A failure only leaves the lists empty: the log itself still works. */
export function useCallLogFilters() {
  return useQuery({
    queryKey: LOG_KEYS.filters,
    queryFn: ({ signal }) => apiFetch(`${BASE}/filters`, { schema: callLogFiltersSchema, signal }),
    retry: false,
    staleTime: 60_000,
  });
}

export function useCallLog(id: string) {
  return useQuery({
    queryKey: LOG_KEYS.detail(id),
    queryFn: ({ signal }) => apiFetch(`${BASE}/${id}`, { schema: callLogDetailSchema, signal }),
    retry: retryUnlessRefused,
  });
}

export function useCallAnalytics(query: Partial<CallAnalyticsQuery>) {
  return useQuery({
    queryKey: LOG_KEYS.analytics(query),
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/analytics`, {
        query: query as Record<string, string | undefined>,
        schema: callAnalyticsSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    retry: retryUnlessRefused,
  });
}

/** Asks for a playback link. Every ask is written to the audit trail on the server, so it is made when the person presses Play. */
export function usePlayback() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`${BASE}/${id}/playback`, { method: 'POST', schema: callPlaybackSchema }),
  });
}

/**
 * Keeps the call screens current: when a call rings, is answered or ends the server pushes `call.changed`, and the lists, the call
 * and the analytics are read again (at most once a second however many pushes arrive). A reconnect or a returning tab does the same.
 * Without a socket nothing happens and the screens keep what they have until the person reloads or changes a filter.
 */
export function useCallLogsLive(): void {
  const qc = useQueryClient();
  const realtime = useRealtimeClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useRef(() => {});
  useEffect(() => {
    refresh.current = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        void qc.invalidateQueries({ queryKey: LOG_KEYS.all });
      }, 1000);
    };
  }, [qc]);

  useEffect(() => {
    if (!realtime) return;
    const off = realtime.subscribe(REALTIME_EVENT.callChanged, () => refresh.current());
    return () => {
      off();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [realtime]);

  useResync(() => refresh.current());
}
