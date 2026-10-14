'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  WIZARD_CONTACT_PAGE_SIZES,
  wizardAudienceCountSchema,
  wizardAudienceSourcesSchema,
  wizardBroadcastDetailSchema,
  wizardBroadcastListSchema,
  wizardContactsPageSchema,
  wizardControlResponseSchema,
  wizardRetryFailedResponseSchema,
  wizardCsvReportSchema,
  wizardCreditCheckSchema,
  wizardDraftResponseSchema,
  wizardLaunchResultSchema,
  wizardSendersResponseSchema,
  wizardTemplatesResponseSchema,
  wizardTestLogSchema,
  wizardTestSendResponseSchema,
  wizardVariablePreviewSchema,
  type SegmentGroup,
  type WizardAudience,
  type WizardCsvReport,
  type WizardVariables,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import type { DraftPatch } from '../lib/state';
import type { TestSendStatusLike } from '../lib/test-log';
import { shouldPollTests } from '../lib/test-log';

/** Every wizard endpoint lives under this prefix. */
export const BASE = '/broadcast-wizard';

export const KEYS = {
  all: ['camp', 'wizard'] as const,
  templates: ['camp', 'wizard', 'templates'] as const,
  senders: ['camp', 'wizard', 'senders'] as const,
  sources: ['camp', 'wizard', 'sources'] as const,
  count: (audience: WizardAudience) => ['camp', 'wizard', 'count', audience] as const,
  credit: (templateId: string, audience: WizardAudience) =>
    ['camp', 'wizard', 'credit', templateId, audience] as const,
  preview: (templateId: string, audience: WizardAudience, variables: WizardVariables) =>
    ['camp', 'wizard', 'preview', templateId, audience, variables] as const,
  draft: (id: string) => ['camp', 'wizard', 'draft', id] as const,
  tests: (id: string) => ['camp', 'wizard', 'tests', id] as const,
  broadcast: (id: string) => ['camp', 'wizard', 'broadcast', id] as const,
};

/** The status page follows the worker while it is open. */
export const STATUS_POLL_MS = 15_000;
/** A test stays "sent" until the provider reports delivery: poll for a short while. */
export const TEST_POLL_MS = 3_000;
export const TEST_POLL_WINDOW_MS = 30_000;

export function useWizardTemplates() {
  return useQuery({
    queryKey: KEYS.templates,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/templates`, { schema: wizardTemplatesResponseSchema, signal }),
    staleTime: 60_000,
  });
}

export function useWizardSenders() {
  return useQuery({
    queryKey: KEYS.senders,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/senders`, { schema: wizardSendersResponseSchema, signal }),
    // The numbers come and go (one connected a moment ago, one that just disconnected): read them again on every visit and when the
    // window regains focus, so the "Send from" list is never a minute behind.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

export function useAudienceSources() {
  return useQuery({
    queryKey: KEYS.sources,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/audience-sources`, { schema: wizardAudienceSourcesSchema, signal }),
    staleTime: 30_000,
  });
}

export function useAudienceCount(audience: WizardAudience | null) {
  return useQuery({
    queryKey: audience ? KEYS.count(audience) : ['camp', 'wizard', 'count', 'none'],
    enabled: audience !== null,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/audience/count`, {
        method: 'POST',
        body: { audience },
        schema: wizardAudienceCountSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 15_000,
  });
}

export function useCreditCheck(templateId: string | null, audience: WizardAudience) {
  return useQuery({
    queryKey: KEYS.credit(templateId ?? '', audience),
    enabled: templateId !== null,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/credit-check`, {
        method: 'POST',
        body: { templateId, audience },
        schema: wizardCreditCheckSchema,
        signal,
      }),
    retry: false,
    // The wallet moves: a check older than a minute is asked again.
    staleTime: 0,
    gcTime: 60_000,
  });
}

export function useVariablePreview(
  templateId: string | null,
  audience: WizardAudience,
  variables: WizardVariables,
) {
  return useQuery({
    queryKey: KEYS.preview(templateId ?? '', audience, variables),
    enabled: templateId !== null,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/variables/preview`, {
        method: 'POST',
        body: { templateId, audience, variables, limit: 3 },
        schema: wizardVariablePreviewSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useWizardDraft(id: string | undefined) {
  return useQuery({
    queryKey: KEYS.draft(id ?? ''),
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/drafts/${id}`, { schema: wizardDraftResponseSchema, signal }),
    retry: false,
    // The wizard holds its own copy once loaded: never refetch under it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export const createDraft = (patch: DraftPatch) =>
  apiFetch(`${BASE}/drafts`, { method: 'POST', body: patch, schema: wizardDraftResponseSchema });

export const updateDraft = (id: string, patch: DraftPatch, rowVersion: number) =>
  apiFetch(`${BASE}/drafts/${id}`, {
    method: 'PUT',
    body: { ...patch, rowVersion },
    schema: wizardDraftResponseSchema,
  });

export const sendTest = (draftId: string, recipients: string) =>
  apiFetch(`${BASE}/test-send`, {
    method: 'POST',
    body: { draftId, recipients },
    schema: wizardTestSendResponseSchema,
  });

/** Recent tests of a draft; polls while one is still "sent" (its delivery report may arrive), for a short window. */
export function useTestLog(draftId: string | undefined, sinceMs: number | null) {
  return useQuery({
    queryKey: KEYS.tests(draftId ?? ''),
    enabled: Boolean(draftId),
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/drafts/${draftId}/test-sends`, { schema: wizardTestLogSchema, signal }),
    refetchInterval: (q) => {
      const rows: TestSendStatusLike[] = q.state.data?.data ?? [];
      return shouldPollTests(rows, sinceMs, Date.now(), TEST_POLL_WINDOW_MS) ? TEST_POLL_MS : false;
    },
  });
}

/** `key` is reused when the same launch is retried, so a double click or a retry cannot launch twice. */
export const launchDraft = (id: string, rowVersion: number, key: string) =>
  apiFetch(`${BASE}/drafts/${id}/launch`, {
    method: 'POST',
    body: { rowVersion },
    schema: wizardLaunchResultSchema,
    idempotencyKey: key,
  });

export function useBroadcast(id: string) {
  return useQuery({
    queryKey: KEYS.broadcast(id),
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/broadcasts/${id}`, { schema: wizardBroadcastDetailSchema, signal }),
    refetchInterval: STATUS_POLL_MS,
    retry: false,
  });
}

/** The newest broadcasts the wizard launched, for the Broadcasts list. Hidden by the caller when it is empty or refused. */
export function useWizardBroadcasts(limit = 5) {
  return useQuery({
    queryKey: [...KEYS.all, 'list', limit] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/broadcasts`, {
        query: { limit },
        schema: wizardBroadcastListSchema,
        signal,
      }),
    refetchInterval: STATUS_POLL_MS,
    retry: false,
  });
}

export type BroadcastAction = 'pause' | 'resume' | 'cancel';
export const controlBroadcast = (id: string, action: BroadcastAction) =>
  apiFetch(`${BASE}/broadcasts/${id}/${action}`, {
    method: 'POST',
    body: {},
    schema: wizardControlResponseSchema,
  });

/** Retry failed: the recipients whose message failed go back in the queue (a series: in every finished run). */
export const retryFailedBroadcast = (id: string) =>
  apiFetch(`${BASE}/broadcasts/${id}/retry-failed`, {
    method: 'POST',
    body: {},
    schema: wizardRetryFailedResponseSchema,
  });

// ---------------------------------------------------------------------------------------- the audience modes

export const PER_PAGE_CHOICES = WIZARD_CONTACT_PAGE_SIZES;

/** One page of the contacts table, searched and filtered on the server. The previous page stays on screen while the next loads. */
export function useWizardContacts(query: {
  search: string;
  rules: SegmentGroup | null;
  page: number;
  perPage: number;
}) {
  return useQuery({
    queryKey: ['camp', 'wizard', 'contacts', query] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/contacts/query`, {
        method: 'POST',
        body: {
          search: query.search.trim() || null,
          rules: query.rules,
          page: query.page,
          perPage: query.perPage,
        },
        schema: wizardContactsPageSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 10_000,
  });
}

/** A stored CSV upload: counts, preview and the first rejected rows (read again after a reload, opted-out numbers live). */
export function useCsvReport(id: string | null) {
  return useQuery({
    queryKey: ['camp', 'wizard', 'csv', id] as const,
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/csv/${id}`, { schema: wizardCsvReportSchema, signal }),
    retry: false,
    staleTime: 30_000,
  });
}

/** Uploads the CSV as multipart; the server parses and validates it and answers with the report. */
export async function uploadCsv(file: File, signal?: AbortSignal): Promise<WizardCsvReport> {
  const form = new FormData();
  form.set('file', file);
  const res = await fetch(`/api/v2${BASE}/csv`, {
    method: 'POST',
    body: form,
    headers: { Accept: 'application/json', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
    signal,
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return wizardCsvReportSchema.parse(json);
}

/** The rejected rows of an upload, with line numbers, as the CSV the API builds. */
export async function downloadCsvErrors(id: string): Promise<Blob> {
  const res = await fetch(`/api/v2${BASE}/csv/${id}/errors`, {
    headers: { Accept: 'text/csv', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
  });
  if (!res.ok) throw toApiError(res.status, undefined, res.headers.get('x-request-id'));
  return res.blob();
}
