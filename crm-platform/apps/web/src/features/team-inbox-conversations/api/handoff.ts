'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  conversationHandoffResponseSchema,
  conversationSummarySchema,
  handoffCardSchema,
  handoffOutcomeSchema,
  handoffSettingsSchema,
  returnToBotResponseSchema,
  type HandoffSettings,
  type RequestHandoffInput,
  type UpdateHandoffSettingsInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { inboxApi } from './service';

/** The handoff calls of the inbox (BL-396..BL-404). Everything is parsed with the shared contracts. */
const claimResponse = z.object({ conversation: conversationSummarySchema, ownerSet: z.boolean() });
/** `refused` is the reason the service gave when it did nothing (an archived thread, spam); the screen shows it as a message. */
const sendResponse = z.object({
  outcome: handoffOutcomeSchema,
  refused: z.string().nullable().optional(),
  conversation: conversationSummarySchema,
  handoff: handoffCardSchema.nullable(),
});

export const handoffApi = {
  card: (conversationId: string, signal?: AbortSignal) =>
    apiFetch(`/inbox/conversations/${conversationId}/handoff`, {
      schema: conversationHandoffResponseSchema,
      signal,
    }),
  claim: (conversationId: string, rowVersion: number, acknowledgeLimit = false) =>
    apiFetch(`/inbox/conversations/${conversationId}/claim`, {
      method: 'POST',
      body: { rowVersion, ...(acknowledgeLimit ? { acknowledgeLimit: true } : {}) },
      schema: claimResponse,
    }),
  send: (conversationId: string, input: RequestHandoffInput) =>
    apiFetch(`/inbox/conversations/${conversationId}/handoff`, {
      method: 'POST',
      body: input,
      schema: sendResponse,
    }),
  returnToBot: (conversationId: string) =>
    apiFetch(`/inbox/conversations/${conversationId}/return-to-bot`, {
      method: 'POST',
      body: {},
      schema: returnToBotResponseSchema,
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

/** Claim, send to the queue and return to bot: each changes the row, the card and the tab counts, so every inbox query is refreshed. */
export function useHandoffActions(conversationId: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['inbox'] });
  // A claim is "take it if nobody holds it": it asks for the row's current version first, so opening the thread (which marks it read and
  // moves the version) never makes the first click a conflict.
  const claim = useMutation({
    mutationFn: async (opts?: { acknowledgeLimit?: boolean }) => {
      const fresh = await inboxApi.conversation(conversationId);
      return handoffApi.claim(conversationId, fresh.rowVersion, opts?.acknowledgeLimit === true);
    },
    onSettled: done,
  });
  const send = useMutation({
    mutationFn: (input: RequestHandoffInput) => handoffApi.send(conversationId, input),
    onSettled: done,
  });
  const giveBack = useMutation({
    mutationFn: () => handoffApi.returnToBot(conversationId),
    onSettled: done,
  });
  return { claim, send, giveBack };
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
