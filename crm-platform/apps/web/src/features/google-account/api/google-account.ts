'use client';

import { useQuery, type QueryClient } from '@tanstack/react-query';
import {
  calendarListResponseSchema,
  googleAccountResponseSchema,
  googleConnectResponseSchema,
  googleConsentRequestSchema,
  googleConsentResultSchema,
  type GoogleCapability,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

export const KEYS = {
  account: ['google-account'] as const,
  calendars: ['google-account', 'calendars'] as const,
  consent: (id: string) => ['google-account', 'consent', id] as const,
};

/**
 * Drops every cached answer about the workspace's Google account, here and in the flow builder (its notice and file pickers, keys
 * `['flb', 'google', ...]`). Call it whenever a connection changes: the builder keeps its answer for 30 s and a client-side navigation
 * back to it would otherwise still say "not connected".
 */
export const refreshGoogleAccount = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: KEYS.account }),
    qc.invalidateQueries({ queryKey: ['flb', 'google'] }),
  ]);

/** Every call of the Google account page. The consent address is a plain call, not a mutation: nothing of it is worth caching. */
export const googleAccountApi = {
  get: (signal?: AbortSignal) =>
    apiFetch('/google-account', { schema: googleAccountResponseSchema, signal }),
  connect: (capabilities: GoogleCapability[], returnTo: string) =>
    apiFetch('/google-account/connect', {
      method: 'POST',
      body: { capabilities, returnTo },
      schema: googleConnectResponseSchema,
    }),
  disconnect: () =>
    apiFetch('/google-account/disconnect', {
      method: 'POST',
      schema: googleAccountResponseSchema,
    }),
  calendars: (signal?: AbortSignal) =>
    apiFetch('/google-account/calendars', { schema: calendarListResponseSchema, signal }),
};

/**
 * The confirmation of a connection (TW-GACC-010): what is about to be connected, and the two ways to end it. The grant is stored only by
 * `confirm`, and only for the person who pressed Connect.
 */
export const googleConsentApi = {
  get: (id: string, signal?: AbortSignal) =>
    apiFetch(`/google-account/consent/${id}`, { schema: googleConsentRequestSchema, signal }),
  confirm: (id: string) =>
    apiFetch(`/google-account/consent/${id}/confirm`, {
      method: 'POST',
      body: {},
      schema: googleConsentResultSchema,
    }),
  cancel: (id: string) =>
    apiFetch(`/google-account/consent/${id}/cancel`, {
      method: 'POST',
      body: {},
      schema: googleConsentResultSchema,
    }),
};

/** A transient failure (5xx, network) is retried once, quickly; a 4xx is final. */
const retryOnce = (failures: number, error: unknown) =>
  !(error instanceof ApiError && error.status < 500) && failures < 1;

export function useGoogleAccount(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.account,
    queryFn: ({ signal }) => googleAccountApi.get(signal),
    enabled,
    refetchOnWindowFocus: true,
    retry: retryOnce,
    retryDelay: 400,
  });
}

/** The calendars the account can write to: only asked once the account is connected with the calendar permission. */
export function useGoogleCalendars(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.calendars,
    queryFn: ({ signal }) => googleAccountApi.calendars(signal),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/** What is about to be connected. A refusal (not yours, expired, used) is final: it is never retried. */
export function useGoogleConsent(id: string | null) {
  return useQuery({
    queryKey: KEYS.consent(id ?? ''),
    queryFn: ({ signal }) => googleConsentApi.get(id!, signal),
    enabled: id !== null,
    retry: retryOnce,
    retryDelay: 400,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}
