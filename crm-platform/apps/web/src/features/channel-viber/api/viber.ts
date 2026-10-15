'use client';

import { useQuery } from '@tanstack/react-query';
import {
  connectViberChannelResponseSchema,
  retryVibBroadcastResponseSchema,
  vibBroadcastComposeSchema,
  vibBroadcastListSchema,
  vibBroadcastSchema,
  viberChannelListSchema,
  viberChannelSchema,
  viberInsightsSchema,
  viberUserListSchema,
  type CreateVibBroadcastInput,
  type VibBroadcastList,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  all: ['viber'] as const,
  channels: ['viber', 'channels'] as const,
  broadcasts: ['viber', 'broadcasts'] as const,
  compose: ['viber', 'compose'] as const,
  users: (channelId: string) => ['viber', 'users', channelId] as const,
  insights: (channelId: string, tz: string) => ['viber', 'insights', channelId, tz] as const,
};

/** A sending broadcast moves on the worker, so the list follows it closely; an idle list only needs an occasional refresh. */
const FAST_MS = 3_000;
const SLOW_MS = 15_000;

export function useChannels() {
  return useQuery({
    queryKey: KEYS.channels,
    queryFn: ({ signal }) =>
      apiFetch('/viber/channels', { schema: viberChannelListSchema, signal }),
    refetchInterval: SLOW_MS,
  });
}

export const isSending = (list: VibBroadcastList | undefined) =>
  list?.data.some((b) => b.status === 'sending') ?? false;

export function useVibBroadcasts() {
  return useQuery({
    queryKey: KEYS.broadcasts,
    queryFn: ({ signal }) =>
      apiFetch('/viber/broadcasts', { schema: vibBroadcastListSchema, signal }),
    refetchInterval: (q) => (isSending(q.state.data) ? FAST_MS : SLOW_MS),
  });
}

export function useCompose() {
  return useQuery({
    queryKey: KEYS.compose,
    queryFn: ({ signal }) =>
      apiFetch('/viber/broadcasts/compose', { schema: vibBroadcastComposeSchema, signal }),
  });
}

/** The users a channel carries; the list swaps when the channel picker changes. */
export function useUsers(channelId: string | undefined) {
  return useQuery({
    queryKey: KEYS.users(channelId ?? ''),
    enabled: Boolean(channelId),
    queryFn: ({ signal }) =>
      apiFetch(`/viber/channels/${channelId}/users`, { schema: viberUserListSchema, signal }),
  });
}

/** Seven days of one channel, in the viewer's own time zone. */
export function useInsights(channelId: string | undefined, tz: string) {
  return useQuery({
    queryKey: KEYS.insights(channelId ?? '', tz),
    queryFn: ({ signal }) =>
      apiFetch('/viber/insights', {
        schema: viberInsightsSchema,
        query: { ...(channelId ? { channel: channelId } : {}), tz },
        signal,
      }),
  });
}

export const connectChannel = (authToken: string) =>
  apiFetch('/viber/channels', {
    method: 'POST',
    body: { authToken },
    schema: connectViberChannelResponseSchema,
  });

export const retryWebhook = (id: string) =>
  apiFetch(`/viber/channels/${id}/retry-webhook`, {
    method: 'POST',
    schema: connectViberChannelResponseSchema,
  });

export const toggleChannel = (id: string) =>
  apiFetch(`/viber/channels/${id}/toggle`, { method: 'POST', schema: viberChannelSchema });

export const removeChannel = (id: string) =>
  apiFetch(`/viber/channels/${id}`, { method: 'DELETE' });

export const createBroadcast = (body: CreateVibBroadcastInput) =>
  apiFetch('/viber/broadcasts', { method: 'POST', body, schema: vibBroadcastSchema });

export const startBroadcast = (id: string) =>
  apiFetch(`/viber/broadcasts/${id}/start`, { method: 'POST', schema: vibBroadcastSchema });

export const pauseBroadcast = (id: string) =>
  apiFetch(`/viber/broadcasts/${id}/pause`, { method: 'POST', schema: vibBroadcastSchema });

export const retryBroadcast = (id: string) =>
  apiFetch(`/viber/broadcasts/${id}/retry`, {
    method: 'POST',
    schema: retryVibBroadcastResponseSchema,
  });

export const deleteBroadcast = (id: string) =>
  apiFetch(`/viber/broadcasts/${id}`, { method: 'DELETE' });
