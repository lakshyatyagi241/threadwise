import { useQuery } from '@tanstack/react-query';
import {
  channelListResponseSchema,
  inboxTemplateListResponseSchema,
  messageResponseSchema,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';

const openedSchema = z.object({ id: z.string().uuid() });

export const sendKeys = {
  channels: ['contacts', 'single-send', 'channels'] as const,
  conversation: (contactId: string, channelId: string) =>
    ['contacts', 'single-send', 'conversation', contactId, channelId] as const,
  templates: (conversationId: string) =>
    ['contacts', 'single-send', 'templates', conversationId] as const,
};

/** The workspace's channels (connected or not); the drawer keeps the connected WhatsApp numbers. */
export function useChannels(enabled: boolean) {
  return useQuery({
    queryKey: sendKeys.channels,
    queryFn: ({ signal }) => apiFetch('/channels', { schema: channelListResponseSchema, signal }),
    enabled,
    staleTime: 60_000,
  });
}

/** The conversation for this contact on this number: the API creates it when there is none yet. */
export function useOpenConversation(contactId: string, channelId: string) {
  return useQuery({
    queryKey: sendKeys.conversation(contactId, channelId),
    queryFn: ({ signal }) =>
      apiFetch('/inbox/conversations/open', {
        method: 'POST',
        body: { contactId, channelId },
        schema: openedSchema,
        signal,
      }),
    enabled: Boolean(contactId && channelId),
    staleTime: Infinity,
    retry: false,
  });
}

/** The approved templates this conversation's number can send. */
export function useConversationTemplates(conversationId: string | undefined) {
  return useQuery({
    queryKey: sendKeys.templates(conversationId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch(`/inbox/conversations/${conversationId}/templates`, {
        schema: inboxTemplateListResponseSchema,
        signal,
      }),
    enabled: Boolean(conversationId),
    staleTime: 30_000,
  });
}

/** Sends one template message. The same `clientMessageId` twice sends once, so a double click cannot text twice. */
export function sendTemplate(
  conversationId: string,
  input: { templateId: string; variables: Record<string, string>; clientMessageId: string },
) {
  return apiFetch(`/inbox/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { kind: 'template', ...input },
    schema: messageResponseSchema,
    idempotencyKey: input.clientMessageId,
  });
}
