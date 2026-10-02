'use client';

import { useQuery } from '@tanstack/react-query';
import {
  botListResponseSchema,
  connectBotResponseSchema,
  botResponseSchema,
  retryTgBroadcastResponseSchema,
  telegramChatListSchema,
  tgBroadcastComposeSchema,
  tgBroadcastListSchema,
  tgBroadcastSchema,
  type CreateTgBroadcastInput,
  type SavePaymentSettingsInput,
  type TgBroadcastList,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  all: ['tg'] as const,
  bots: ['tg', 'bots'] as const,
  broadcasts: ['tg', 'broadcasts'] as const,
  compose: ['tg', 'compose'] as const,
  chats: (botId: string) => ['tg', 'chats', botId] as const,
};

/** A sending broadcast moves on the worker, so the list follows it closely; an idle list only needs an occasional refresh. */
const FAST_MS = 3_000;
const SLOW_MS = 15_000;

export function useBots() {
  return useQuery({
    queryKey: KEYS.bots,
    queryFn: ({ signal }) => apiFetch('/telegram/bots', { schema: botListResponseSchema, signal }),
    refetchInterval: SLOW_MS,
  });
}

export function useTgBroadcasts() {
  return useQuery({
    queryKey: KEYS.broadcasts,
    queryFn: ({ signal }) =>
      apiFetch('/telegram/broadcasts', { schema: tgBroadcastListSchema, signal }),
    refetchInterval: (q) => (isSending(q.state.data) ? FAST_MS : SLOW_MS),
  });
}

export const isSending = (list: TgBroadcastList | undefined) =>
  list?.data.some((b) => b.status === 'sending') ?? false;

export function useCompose() {
  return useQuery({
    queryKey: KEYS.compose,
    queryFn: ({ signal }) =>
      apiFetch('/telegram/broadcasts/compose', { schema: tgBroadcastComposeSchema, signal }),
  });
}

/** The chats a bot carries; the list swaps when the bot picker changes. */
export function useChats(botId: string | undefined) {
  return useQuery({
    queryKey: KEYS.chats(botId ?? ''),
    enabled: Boolean(botId),
    queryFn: ({ signal }) =>
      apiFetch(`/telegram/bots/${botId}/chats`, { schema: telegramChatListSchema, signal }),
  });
}

export const connectBot = (botToken: string) =>
  apiFetch('/telegram/bots', {
    method: 'POST',
    body: { botToken },
    schema: connectBotResponseSchema,
  });

export const retryWebhook = (id: string) =>
  apiFetch(`/telegram/bots/${id}/retry-webhook`, {
    method: 'POST',
    schema: connectBotResponseSchema,
  });

export const toggleBot = (id: string) =>
  apiFetch(`/telegram/bots/${id}/toggle`, { method: 'POST', schema: botResponseSchema });

export const savePayments = (id: string, body: SavePaymentSettingsInput) =>
  apiFetch(`/telegram/bots/${id}/payments`, { method: 'PUT', body, schema: botResponseSchema });

export const removeBot = (id: string) => apiFetch(`/telegram/bots/${id}`, { method: 'DELETE' });

export const createBroadcast = (body: CreateTgBroadcastInput) =>
  apiFetch('/telegram/broadcasts', { method: 'POST', body, schema: tgBroadcastSchema });

export const startBroadcast = (id: string) =>
  apiFetch(`/telegram/broadcasts/${id}/start`, { method: 'POST', schema: tgBroadcastSchema });

export const pauseBroadcast = (id: string) =>
  apiFetch(`/telegram/broadcasts/${id}/pause`, { method: 'POST', schema: tgBroadcastSchema });

export const retryBroadcast = (id: string) =>
  apiFetch(`/telegram/broadcasts/${id}/retry`, {
    method: 'POST',
    schema: retryTgBroadcastResponseSchema,
  });

export const deleteBroadcast = (id: string) =>
  apiFetch(`/telegram/broadcasts/${id}`, { method: 'DELETE' });
