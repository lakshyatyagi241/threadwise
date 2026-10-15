'use client';

import { useQuery } from '@tanstack/react-query';
import {
  connectLineChannelResponseSchema,
  lineAudienceListSchema,
  lineBroadcastComposeSchema,
  lineBroadcastListSchema,
  lineBroadcastSchema,
  lineChannelListResponseSchema,
  lineChannelResponseSchema,
  retryLineBroadcastResponseSchema,
  type CreateLineBroadcastInput,
  type LineBroadcastList,
  type SaveLineRotationInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  all: ['line'] as const,
  channels: ['line', 'channels'] as const,
  broadcasts: ['line', 'broadcasts'] as const,
  compose: ['line', 'compose'] as const,
  audience: (channelId: string) => ['line', 'audience', channelId] as const,
};

/** A sending broadcast moves on the worker, so the list follows it closely; an idle list only needs an occasional refresh. */
const FAST_MS = 3_000;
const SLOW_MS = 15_000;

export function useChannels() {
  return useQuery({
    queryKey: KEYS.channels,
    queryFn: ({ signal }) =>
      apiFetch('/line/channels', { schema: lineChannelListResponseSchema, signal }),
    refetchInterval: SLOW_MS,
  });
}

export const isSending = (list: LineBroadcastList | undefined) =>
  list?.data.some((b) => b.status === 'sending') ?? false;

export function useLineBroadcasts() {
  return useQuery({
    queryKey: KEYS.broadcasts,
    queryFn: ({ signal }) =>
      apiFetch('/line/broadcasts', { schema: lineBroadcastListSchema, signal }),
    refetchInterval: (q) => (isSending(q.state.data) ? FAST_MS : SLOW_MS),
  });
}

export function useCompose() {
  return useQuery({
    queryKey: KEYS.compose,
    queryFn: ({ signal }) =>
      apiFetch('/line/broadcasts/compose', { schema: lineBroadcastComposeSchema, signal }),
  });
}

/** The people a channel carries; the list swaps when the channel picker changes. */
export function useAudience(channelId: string | undefined) {
  return useQuery({
    queryKey: KEYS.audience(channelId ?? ''),
    enabled: Boolean(channelId),
    queryFn: ({ signal }) =>
      apiFetch(`/line/channels/${channelId}/audience`, { schema: lineAudienceListSchema, signal }),
  });
}

export const connectChannel = (channelAccessToken: string, channelSecret: string) =>
  apiFetch('/line/channels', {
    method: 'POST',
    body: { channelAccessToken, channelSecret },
    schema: connectLineChannelResponseSchema,
  });

export const retryWebhook = (id: string) =>
  apiFetch(`/line/channels/${id}/retry-webhook`, {
    method: 'POST',
    schema: connectLineChannelResponseSchema,
  });

export const toggleChannel = (id: string) =>
  apiFetch(`/line/channels/${id}/toggle`, { method: 'POST', schema: lineChannelResponseSchema });

export const saveRotation = (id: string, body: SaveLineRotationInput) =>
  apiFetch(`/line/channels/${id}/rotation`, {
    method: 'PUT',
    body,
    schema: lineChannelResponseSchema,
  });

export const removeChannel = (id: string) => apiFetch(`/line/channels/${id}`, { method: 'DELETE' });

export const createBroadcast = (body: CreateLineBroadcastInput) =>
  apiFetch('/line/broadcasts', { method: 'POST', body, schema: lineBroadcastSchema });

export const startBroadcast = (id: string) =>
  apiFetch(`/line/broadcasts/${id}/start`, { method: 'POST', schema: lineBroadcastSchema });

export const pauseBroadcast = (id: string) =>
  apiFetch(`/line/broadcasts/${id}/pause`, { method: 'POST', schema: lineBroadcastSchema });

export const retryBroadcast = (id: string) =>
  apiFetch(`/line/broadcasts/${id}/retry`, {
    method: 'POST',
    schema: retryLineBroadcastResponseSchema,
  });

export const deleteBroadcast = (id: string) =>
  apiFetch(`/line/broadcasts/${id}`, { method: 'DELETE' });
