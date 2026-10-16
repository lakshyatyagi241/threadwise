'use client';

import { useQuery } from '@tanstack/react-query';
import {
  backfillLeadsResponseSchema,
  leadInboxDetailResponseSchema,
  leadInboxItemSchema,
  leadInboxListResponseSchema,
  leadInboxSummaryResponseSchema,
  leadPullSourcesResponseSchema,
  leadSyncRunSchema,
  leadSyncRunsResponseSchema,
  retryLeadInboxResponseSchema,
  speedToLeadOptionsResponseSchema,
  type SpeedToLeadChannel,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { anyOpen } from './lib/inbox-view';

/**
 * The calls of the lead pipeline's operations screens (speed-to-lead's pickers, the lead inbox), kept apart from the source screens'
 * own `api.ts`. Same rules: through the same-origin proxy, every answer parsed with its contract schema at the boundary.
 */

const ROOT = '/lead-sources';
const INBOX = '/lead-inbox';

export const opsKeys = {
  speedOptions: (channel: SpeedToLeadChannel) =>
    ['lead-sources', 'speed-options', channel] as const,
  all: ['lead-inbox'] as const,
  list: (filters: string) => ['lead-inbox', 'list', filters] as const,
  summary: (filters: string) => ['lead-inbox', 'summary', filters] as const,
  item: (id: string) => ['lead-inbox', 'item', id] as const,
  pullSources: ['lead-inbox', 'pull-sources'] as const,
  runs: ['lead-inbox', 'runs'] as const,
};

// --- speed-to-lead -----------------------------------------------------------------------------------------------------------------

/** The templates and senders the first-message setting can choose from on a channel. */
export const fetchSpeedOptions = (channel: SpeedToLeadChannel, signal?: AbortSignal) =>
  apiFetch(`${ROOT}/speed-to-lead/options`, {
    query: { channel },
    schema: speedToLeadOptionsResponseSchema,
    signal,
  });

export const useSpeedOptions = (channel: SpeedToLeadChannel, enabled: boolean) =>
  useQuery({
    queryKey: opsKeys.speedOptions(channel),
    queryFn: ({ signal }) => fetchSpeedOptions(channel, signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  });

// --- the lead inbox ----------------------------------------------------------------------------------------------------------------

type Query = Record<string, string | number | undefined>;

export const fetchInbox = (query: Query, cursor: string | undefined, signal?: AbortSignal) =>
  apiFetch(INBOX, {
    query: { limit: 25, ...query, cursor },
    schema: leadInboxListResponseSchema,
    signal,
  });

export const fetchInboxSummary = (query: Query, signal?: AbortSignal) =>
  apiFetch(`${INBOX}/summary`, { query, schema: leadInboxSummaryResponseSchema, signal });

/** Audited: opening a payload writes an audit row, so it is called only when the person opens the lead. */
export const fetchInboxItem = (id: string, signal?: AbortSignal) =>
  apiFetch(`${INBOX}/${id}`, { schema: leadInboxDetailResponseSchema, signal });

export const retryInboxItem = (id: string) =>
  apiFetch(`${INBOX}/${id}/retry`, { method: 'POST', schema: leadInboxItemSchema });

export const retryInboxMany = (eventIds: string[]) =>
  apiFetch(`${INBOX}/retry`, {
    method: 'POST',
    body: { eventIds },
    schema: retryLeadInboxResponseSchema,
  });

// --- pulling -----------------------------------------------------------------------------------------------------------------------

export const fetchPullSources = (signal?: AbortSignal) =>
  apiFetch(`${INBOX}/sources`, { schema: leadPullSourcesResponseSchema, signal });

export const fetchRuns = (signal?: AbortSignal) =>
  apiFetch(`${INBOX}/runs`, { query: { limit: 10 }, schema: leadSyncRunsResponseSchema, signal });

export const syncSourceNow = (sourceId: string) =>
  apiFetch(`${INBOX}/sources/${sourceId}/sync`, { method: 'POST', schema: leadSyncRunSchema });

export const backfillSources = (body: { from: string; to: string; sourceIds: string[] }) =>
  apiFetch(`${INBOX}/backfill`, { method: 'POST', body, schema: backfillLeadsResponseSchema });

/** The runs, asked again every few seconds while one is queued or running (the progress bar), and left alone otherwise. */
export const useRuns = (enabled: boolean) =>
  useQuery({
    queryKey: opsKeys.runs,
    queryFn: ({ signal }) => fetchRuns(signal),
    enabled,
    retry: false,
    refetchInterval: (q) => (q.state.data && anyOpen(q.state.data.data) ? 3_000 : false),
  });

export const usePullSources = (enabled: boolean, polling: boolean) =>
  useQuery({
    queryKey: opsKeys.pullSources,
    queryFn: ({ signal }) => fetchPullSources(signal),
    enabled,
    retry: false,
    refetchInterval: polling ? 3_000 : false,
  });
