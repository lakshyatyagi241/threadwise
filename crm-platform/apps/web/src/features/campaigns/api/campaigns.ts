'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  aiModelsResponseSchema,
  bulkDeleteCampaignsResponseSchema,
  campaignAiGenerateResponseSchema,
  campaignActionResponseSchema,
  campaignBuilderSchema,
  campaignConfigSchema,
  campaignDetailSchema,
  campaignListResponseSchema,
  campaignLiveSchema,
  campaignRecipientsResponseSchema,
  campaignStatisticsSchema,
  resendCampaignResponseSchema,
  type CampaignAiGenerateInput,
  type CreateCampaignInput,
  type ResendCampaignInput,
  type UpdateCampaignInput,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import type { ListState } from '../lib/list-model';
import { stateToQuery } from '../lib/list-model';
import { detailInterval, liveInterval } from '../lib/live-model';

export const KEYS = {
  all: ['camp'] as const,
  list: ['camp', 'list'] as const,
  builder: ['camp', 'builder'] as const,
  detail: (id: string) => ['camp', 'detail', id] as const,
  config: (id: string) => ['camp', 'config', id] as const,
  recipients: (id: string) => ['camp', 'recipients', id] as const,
};

/** Campaigns move on the worker, so the list and the detail follow along while the tab is open (Reference polled the detail every 15 s). */
export const POLL_MS = 15_000;

export function useCampaignList(state: ListState) {
  return useQuery({
    queryKey: [...KEYS.list, stateToQuery(state)],
    queryFn: ({ signal }) =>
      apiFetch('/campaigns', {
        query: stateToQuery(state),
        schema: campaignListResponseSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
    // The list polls anyway, so a failed read shows its error state at once instead of a spinner through the retries.
    retry: false,
  });
}

/** `channel: 'sms'` lists the SMS senders and templates instead of the WhatsApp ones (TW-SMS-018). */
export function useBuilder(channel?: 'sms') {
  return useQuery({
    queryKey: channel ? ([...KEYS.builder, channel] as const) : KEYS.builder,
    queryFn: ({ signal }) =>
      apiFetch(channel ? `/campaigns/builder?channel=${channel}` : '/campaigns/builder', {
        schema: campaignBuilderSchema,
        signal,
      }),
    retry: false,
    // The numbers come and go (a number connected a moment ago, one that just disconnected): read them again on every visit and when
    // the window regains focus, so the "Send from" list is never a minute behind.
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

export function useCampaignConfig(id: string | undefined) {
  return useQuery({
    queryKey: KEYS.config(id ?? ''),
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      apiFetch(`/campaigns/${id}/config`, { schema: campaignConfigSchema, signal }),
  });
}

export function useCampaignDetail(id: string) {
  return useQuery({
    queryKey: KEYS.detail(id),
    queryFn: ({ signal }) => apiFetch(`/campaigns/${id}`, { schema: campaignDetailSchema, signal }),
    // The heavy read follows along slowly; the live stats below carry the fast-moving numbers while the campaign is in flight.
    refetchInterval: (q) => detailInterval(q.state.data?.campaign.status),
  });
}

/**
 * Live stats: the light read, asked every 12 seconds while the campaign is scheduled or running and never once it is at rest. Pass
 * `enabled` from the detail's status; the interval then stops by itself the moment the server says `inFlight: false`. A hidden tab
 * pauses it (react-query does not poll in the background) and a returning tab asks again at once.
 */
export function useCampaignLive(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEYS.detail(id), 'live'],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`/campaigns/${id}/live`, { schema: campaignLiveSchema, signal }),
    refetchInterval: (q) => liveInterval(q.state.data),
  });
}

/** Statistics: where every recipient is now and the campaign's timeline; follows the campaign like the live stats do. */
export function useCampaignStatistics(id: string) {
  return useQuery({
    queryKey: [...KEYS.detail(id), 'statistics'],
    queryFn: ({ signal }) =>
      apiFetch(`/campaigns/${id}/statistics`, { schema: campaignStatisticsSchema, signal }),
    refetchInterval: (q) => liveInterval(q.state.data),
  });
}

export function useRecipients(id: string, q: { status: string; q: string; page: number }) {
  return useQuery({
    queryKey: [...KEYS.recipients(id), q],
    queryFn: ({ signal }) =>
      apiFetch(`/campaigns/${id}/recipients`, {
        query: { status: q.status === 'all' ? undefined : q.status, q: q.q, page: q.page },
        schema: campaignRecipientsResponseSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
  });
}

const created = z.object({
  campaign: z.object({ id: z.string() }).passthrough(),
  message: z.string(),
});

export const createCampaign = (body: CreateCampaignInput) =>
  apiFetch('/campaigns', { method: 'POST', body, schema: created });

/** "Build with AI" (TW-CAMP-002): the copy for a campaign from a brief. Nothing is stored. */
export const aiGenerateCampaign = (body: CampaignAiGenerateInput) =>
  apiFetch('/campaigns/ai-generate', {
    method: 'POST',
    body,
    schema: campaignAiGenerateResponseSchema,
  });

/** The text models this workspace may use (the platform's enabled ones and any provider it added its own key for). */
export function useAiModels(enabled: boolean) {
  return useQuery({
    queryKey: ['camp', 'ai-models'] as const,
    queryFn: ({ signal }) => apiFetch('/ai/models', { schema: aiModelsResponseSchema, signal }),
    select: (r) => r.data,
    enabled,
    staleTime: 60_000,
  });
}

export const updateCampaign = (id: string, body: UpdateCampaignInput) =>
  apiFetch(`/campaigns/${id}`, { method: 'PUT', body, schema: created });

const action = (id: string, path: string, body?: object) =>
  apiFetch(`/campaigns/${id}/${path}`, {
    method: 'POST',
    body: body ?? {},
    schema: campaignActionResponseSchema,
  });
export const cancelCampaign = (id: string) => action(id, 'cancel');
export const resumeCampaign = (id: string) => action(id, 'resume');
export const sendNowCampaign = (id: string) => action(id, 'send-now');
export const resendCampaign = (id: string, body: ResendCampaignInput) =>
  apiFetch(`/campaigns/${id}/resend`, {
    method: 'POST',
    body,
    schema: resendCampaignResponseSchema,
  });
export const deleteCampaign = (id: string) => apiFetch(`/campaigns/${id}`, { method: 'DELETE' });
export const bulkDeleteCampaigns = (ids: string[]) =>
  apiFetch('/campaigns/bulk-delete', {
    method: 'POST',
    body: { ids },
    schema: bulkDeleteCampaignsResponseSchema,
  });

/** A file the server streams (the recipients CSV, the sample CSV): fetched with the session and handed back as a blob. */
export async function download(path: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`/api/v2${path}`, {
    headers: { Accept: 'text/csv, application/json', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    throw toApiError(res.status, json, res.headers.get('x-request-id'));
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'campaign.csv';
  return { blob: await res.blob(), filename };
}
