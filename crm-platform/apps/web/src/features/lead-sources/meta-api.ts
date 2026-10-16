'use client';

import { useQuery } from '@tanstack/react-query';
import {
  metaLeadAdsOverviewSchema,
  metaLeadConnectStartSchema,
  metaLeadFormListSchema,
  metaLeadFormSchema,
  metaLeadPageSchema,
  metaLeadSourceHealthSchema,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { leadKeys } from './api';

/**
 * Every call of the Meta lead forms panel, through the same-origin proxy (`/api/v2/meta-lead-ads/*`). Responses are parsed with the
 * contract schemas at the boundary. Nothing here carries a token: the Page's token stays in the Facebook channel on the server.
 */

const ROOT = '/meta-lead-ads';
const page = (id: string) => `${ROOT}/pages/${encodeURIComponent(id)}`;

export const fetchMetaOverview = (signal?: AbortSignal) =>
  apiFetch(ROOT, { schema: metaLeadAdsOverviewSchema, signal });

/** The Facebook login that asks for the lead permissions. The caller sends the browser to the returned address. */
export const startMetaLogin = () =>
  apiFetch(`${ROOT}/connect/start`, { method: 'POST', schema: metaLeadConnectStartSchema });

export const enableMetaPage = (id: string) =>
  apiFetch(`${page(id)}/enable`, { method: 'POST', schema: metaLeadPageSchema });

export const disableMetaPage = (id: string) =>
  apiFetch(`${page(id)}/disable`, { method: 'POST', schema: metaLeadPageSchema });

/** Read from Meta with the Page's token on every call: this is a manage-only route that can take a moment. */
export const fetchMetaForms = (id: string, signal?: AbortSignal) =>
  apiFetch(`${page(id)}/forms`, { schema: metaLeadFormListSchema, signal });

export const connectMetaForm = (id: string, formId: string) =>
  apiFetch(`${page(id)}/forms/${encodeURIComponent(formId)}/connect`, {
    method: 'POST',
    schema: metaLeadFormSchema,
  });

/** 204: the form's lead source and the leads stored under it are gone; the contacts they made stay. */
export const disconnectMetaForm = (id: string, formId: string): Promise<void> =>
  apiFetch(`${page(id)}/forms/${encodeURIComponent(formId)}`, { method: 'DELETE' });

export const fetchMetaHealth = (sourceId: string, signal?: AbortSignal) =>
  apiFetch(`${ROOT}/sources/${encodeURIComponent(sourceId)}/health`, {
    schema: metaLeadSourceHealthSchema,
    signal,
  });

/** The Pages and their lead sync state. Shared by the provider card and the panel, so one request serves both. */
export const useMetaOverview = (enabled: boolean) =>
  useQuery({
    queryKey: leadKeys.meta,
    queryFn: ({ signal }) => fetchMetaOverview(signal),
    enabled,
    retry: false,
    staleTime: 30_000,
  });

/** One form source's health, for the source's own screen. */
export const useMetaHealth = (sourceId: string, enabled: boolean) =>
  useQuery({
    queryKey: leadKeys.metaHealth(sourceId),
    queryFn: ({ signal }) => fetchMetaHealth(sourceId, signal),
    enabled,
    retry: false,
  });
