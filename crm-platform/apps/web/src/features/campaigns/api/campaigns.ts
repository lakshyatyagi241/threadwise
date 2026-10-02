'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  bulkDeleteCampaignsResponseSchema,
  campaignActionResponseSchema,
  campaignBuilderSchema,
  campaignConfigSchema,
  campaignDetailSchema,
  campaignListResponseSchema,
  campaignLiveSchema,
  campaignRecipientsResponseSchema,
  resendCampaignResponseSchema,
  type CreateCampaignInput,
  type ResendCampaignInput,
  type UpdateCampaignInput,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import type { ListState } from '../lib/list-model';
import { stateToQuery } from '../lib/list-model';

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
  });
}

export function useBuilder() {
  return useQuery({
    queryKey: KEYS.builder,
    queryFn: ({ signal }) =>
      apiFetch('/campaigns/builder', { schema: campaignBuilderSchema, signal }),
    retry: false,
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
    refetchInterval: POLL_MS,
  });
}

export function useCampaignLive(id: string) {
  return useQuery({
    queryKey: [...KEYS.detail(id), 'live'],
    queryFn: ({ signal }) =>
      apiFetch(`/campaigns/${id}/live`, { schema: campaignLiveSchema, signal }),
    refetchInterval: POLL_MS,
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
