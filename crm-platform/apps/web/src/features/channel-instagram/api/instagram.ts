'use client';

import { useQuery } from '@tanstack/react-query';
import {
  igAccountListSchema,
  igAccountSchema,
  igAvailableListSchema,
  igComposeSchema,
  igConnectStartResponseSchema,
  igSendResultSchema,
  igUnlinkResultSchema,
  type LinkIgAccountInput,
  type SendIgBroadcastInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  all: ['ig'] as const,
  accounts: ['ig', 'accounts'] as const,
  compose: ['ig', 'compose'] as const,
};

/** The linked accounts and the engine behind them. They change when someone links or unlinks, so an occasional refresh is enough. */
export const useAccounts = () =>
  useQuery({
    queryKey: KEYS.accounts,
    queryFn: ({ signal }) =>
      apiFetch('/instagram/accounts', { schema: igAccountListSchema, signal }),
    refetchInterval: 30_000,
  });

/** The accounts the person already owns on the engine and has not linked. `signal` lets the caller stop waiting. */
export const fetchAvailable = (signal?: AbortSignal) =>
  apiFetch('/instagram/accounts/available', { schema: igAvailableListSchema, signal });

export const linkAccount = (body: LinkIgAccountInput) =>
  apiFetch('/instagram/accounts', { method: 'POST', body, schema: igAccountSchema });

export const startConnect = () =>
  apiFetch('/instagram/connect/start', { method: 'POST', schema: igConnectStartResponseSchema });

export const unlinkAccount = (id: string) =>
  apiFetch(`/instagram/accounts/${id}`, { method: 'DELETE', schema: igUnlinkResultSchema });

/** The connected accounts with their threads and the Instagram templates, for the reply-only compose screen. */
export const useCompose = () =>
  useQuery({
    queryKey: KEYS.compose,
    queryFn: ({ signal }) => apiFetch('/instagram/compose', { schema: igComposeSchema, signal }),
  });

export const sendBroadcast = (body: SendIgBroadcastInput) =>
  apiFetch('/instagram/broadcasts', { method: 'POST', body, schema: igSendResultSchema });
