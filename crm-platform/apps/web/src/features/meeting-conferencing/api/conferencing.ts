'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  conferencingCapabilitiesSchema,
  conferencingConnectionListSchema,
  conferencingConnectionSchema,
  conferencingStartResponseSchema,
  contactMeetingResponseSchema,
  type ConnectedVideoProvider,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

export const KEYS = {
  capabilities: ['conferencing', 'capabilities'] as const,
  connections: ['conferencing', 'connections'] as const,
};

/** Every call of video conferencing for meetings (BL-360..BL-362). */
export const conferencingApi = {
  capabilities: (signal?: AbortSignal) =>
    apiFetch('/conferencing/capabilities', { schema: conferencingCapabilitiesSchema, signal }),
  connections: (signal?: AbortSignal) =>
    apiFetch('/conferencing/connections', { schema: conferencingConnectionListSchema, signal }),
  start: (provider: ConnectedVideoProvider, returnTo: string) =>
    apiFetch(`/conferencing/${provider}/start`, {
      method: 'POST',
      body: { returnTo },
      schema: conferencingStartResponseSchema,
    }),
  confirm: (provider: ConnectedVideoProvider, ticket: string) =>
    apiFetch(`/conferencing/${provider}/confirm`, {
      method: 'POST',
      body: { ticket },
      schema: conferencingConnectionSchema,
    }),
  disconnect: (provider: ConnectedVideoProvider) =>
    apiFetch(`/conferencing/${provider}`, {
      method: 'DELETE',
      schema: conferencingConnectionSchema,
    }),
  retry: (contactId: string, meetingId: string) =>
    apiFetch(`/contacts/${contactId}/meetings/${meetingId}/conferencing/retry`, {
      method: 'POST',
      body: {},
      schema: contactMeetingResponseSchema,
    }),
};

/** A transient failure (5xx, network) is retried once, quickly; a 4xx is final. */
const retryOnce = (failures: number, error: unknown) =>
  !(error instanceof ApiError && error.status < 500) && failures < 1;

/**
 * What the Add meeting form may offer this person. A failure is not an error the form shows: it simply offers nothing (the form must
 * work without any video option), so there is no retry loop beyond the one quick try.
 */
export function useConferencingCapabilities(enabled = true) {
  return useQuery({
    queryKey: KEYS.capabilities,
    queryFn: ({ signal }) => conferencingApi.capabilities(signal),
    enabled,
    staleTime: 30_000,
    retry: retryOnce,
    retryDelay: 400,
  });
}

export function useConferencingConnections(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.connections,
    queryFn: ({ signal }) => conferencingApi.connections(signal),
    enabled,
    refetchOnWindowFocus: true,
    retry: retryOnce,
    retryDelay: 400,
  });
}

/** Retry a meeting's video link or calendar entry; refreshes the meetings list the caller passes the key of. */
export function useRetryConferencing(contactId: string, listKey: readonly unknown[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) => conferencingApi.retry(contactId, meetingId),
    onSettled: () => qc.invalidateQueries({ queryKey: listKey }),
  });
}
