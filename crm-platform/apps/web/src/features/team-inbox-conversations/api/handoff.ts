'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  conversationHandoffResponseSchema,
  conversationSummarySchema,
  handoffSettingsSchema,
  type HandoffSettings,
  type UpdateHandoffSettingsInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/** The handoff calls of the inbox (BL-396..BL-404). Everything is parsed with the shared contracts. */
const claimResponse = z.object({ conversation: conversationSummarySchema, ownerSet: z.boolean() });
const returnResponse = z.object({ conversation: conversationSummarySchema });

export const handoffApi = {
  card: (conversationId: string, signal?: AbortSignal) =>
    apiFetch(`/inbox/conversations/${conversationId}/handoff`, {
      schema: conversationHandoffResponseSchema,
      signal,
    }),
  claim: (conversationId: string, rowVersion: number) =>
    apiFetch(`/inbox/conversations/${conversationId}/claim`, {
      method: 'POST',
      body: { rowVersion },
      schema: claimResponse,
    }),
  returnToBot: (conversationId: string) =>
    apiFetch(`/inbox/conversations/${conversationId}/return-to-bot`, {
      method: 'POST',
      body: {},
      schema: returnResponse,
    }),
  settings: (signal?: AbortSignal) =>
    apiFetch('/inbox/handoff-settings', { schema: handoffSettingsSchema, signal }),
  updateSettings: (input: UpdateHandoffSettingsInput) =>
    apiFetch('/inbox/handoff-settings', {
      method: 'PUT',
      body: input,
      schema: handoffSettingsSchema,
    }),
};

export const HANDOFF_KEYS = {
  card: (id: string) => ['inbox', 'handoff', id] as const,
  settings: ['inbox', 'handoff-settings'] as const,
};

/** The latest handoff card of the open conversation; only asked for while a handoff holds the thread. */
export function useHandoffCard(conversationId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: HANDOFF_KEYS.card(conversationId ?? ''),
    queryFn: ({ signal }) => handoffApi.card(conversationId!, signal),
    enabled: enabled && conversationId !== null,
    staleTime: 10_000,
    retry: false,
  });
}

/** Claim and return to bot: both change the row, the card, the tab counts, so every inbox query is refreshed. */
export function useHandoffActions(conversationId: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['inbox'] });
  const claim = useMutation({
    mutationFn: (rowVersion: number) => handoffApi.claim(conversationId, rowVersion),
    onSettled: done,
  });
  const giveBack = useMutation({
    mutationFn: () => handoffApi.returnToBot(conversationId),
    onSettled: done,
  });
  return { claim, giveBack };
}

export function useHandoffSettings(enabled: boolean) {
  return useQuery({
    queryKey: HANDOFF_KEYS.settings,
    queryFn: ({ signal }) => handoffApi.settings(signal),
    enabled,
    retry: false,
  });
}

export function useUpdateHandoffSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateHandoffSettingsInput) => handoffApi.updateSettings(input),
    onSuccess: (data: HandoffSettings) => qc.setQueryData(HANDOFF_KEYS.settings, data),
  });
}
