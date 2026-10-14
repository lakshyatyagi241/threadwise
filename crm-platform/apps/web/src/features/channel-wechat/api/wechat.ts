'use client';

import { useQuery } from '@tanstack/react-query';
import {
  recheckWechatChannelResponseSchema,
  wechatBroadcastComposeSchema,
  wechatBroadcastListSchema,
  wechatBroadcastSchema,
  wechatChannelListSchema,
  wechatChannelSchema,
  wechatChatListSchema,
  wechatServerConfigSchema,
  type ConnectWechatChannelInput,
  type CreateWechatBroadcastInput,
  type WechatBroadcastList,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  all: ['wechat'] as const,
  channels: ['wechat', 'channels'] as const,
  broadcasts: ['wechat', 'broadcasts'] as const,
  compose: ['wechat', 'compose'] as const,
  chats: (channelId: string) => ['wechat', 'chats', channelId] as const,
  serverConfig: (channelId: string) => ['wechat', 'server-config', channelId] as const,
};

/** A sending broadcast moves on the worker, so the list follows it closely; an idle list only needs an occasional refresh. */
const FAST_MS = 3_000;
const SLOW_MS = 15_000;

export function useChannels() {
  return useQuery({
    queryKey: KEYS.channels,
    queryFn: ({ signal }) =>
      apiFetch('/wechat/channels', { schema: wechatChannelListSchema, signal }),
    refetchInterval: SLOW_MS,
  });
}

export const isSending = (list: WechatBroadcastList | undefined) =>
  list?.data.some((b) => b.status === 'sending') ?? false;

export function useBroadcasts() {
  return useQuery({
    queryKey: KEYS.broadcasts,
    queryFn: ({ signal }) =>
      apiFetch('/wechat/broadcasts', { schema: wechatBroadcastListSchema, signal }),
    refetchInterval: (q) => (isSending(q.state.data) ? FAST_MS : SLOW_MS),
  });
}

export function useCompose() {
  return useQuery({
    queryKey: KEYS.compose,
    queryFn: ({ signal }) =>
      apiFetch('/wechat/broadcasts/compose', { schema: wechatBroadcastComposeSchema, signal }),
  });
}

/** The followers a channel carries; the list swaps when the channel picker changes. */
export function useChats(channelId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.chats(channelId ?? ''),
    enabled: Boolean(channelId) && enabled,
    queryFn: ({ signal }) =>
      apiFetch(`/wechat/channels/${channelId}/chats`, { schema: wechatChatListSchema, signal }),
  });
}

/** The address and Token to paste into the WeChat console; only asked for when the person reveals it. */
export function useServerConfig(channelId: string, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.serverConfig(channelId),
    enabled,
    staleTime: 0,
    gcTime: 0,
    queryFn: ({ signal }) =>
      apiFetch(`/wechat/channels/${channelId}/server-config`, {
        schema: wechatServerConfigSchema,
        signal,
      }),
  });
}

export const connectChannel = (body: ConnectWechatChannelInput) =>
  apiFetch('/wechat/channels', { method: 'POST', body, schema: wechatChannelSchema });

export const recheckChannel = (id: string) =>
  apiFetch(`/wechat/channels/${id}/recheck`, {
    method: 'POST',
    schema: recheckWechatChannelResponseSchema,
  });

export const toggleChannel = (id: string) =>
  apiFetch(`/wechat/channels/${id}/toggle`, { method: 'POST', schema: wechatChannelSchema });

export const removeChannel = (id: string) =>
  apiFetch(`/wechat/channels/${id}`, { method: 'DELETE' });

export const createBroadcast = (body: CreateWechatBroadcastInput) =>
  apiFetch('/wechat/broadcasts', { method: 'POST', body, schema: wechatBroadcastSchema });

export const startBroadcast = (id: string) =>
  apiFetch(`/wechat/broadcasts/${id}/start`, { method: 'POST', schema: wechatBroadcastSchema });

export const retryBroadcast = (id: string) =>
  apiFetch(`/wechat/broadcasts/${id}/retry`, { method: 'POST', schema: wechatBroadcastSchema });

export const deleteBroadcast = (id: string) =>
  apiFetch(`/wechat/broadcasts/${id}`, { method: 'DELETE' });
