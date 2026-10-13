import {
  assignConversationResponseSchema,
  conversationListResponseSchema,
  conversationSummarySchema,
  inboxConversationDetailSchema,
  markConversationReadResponseSchema,
  messageListResponseSchema,
  messageResponseSchema,
  type SetConversationStatusInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';
import type { InboxFilters } from './filters';

export const CONVERSATIONS_PAGE_SIZE = 20;
export const MESSAGES_PAGE_SIZE = 30;

/** One page of the conversation list (WD-INBOX): the tab, the status filter and the search words go to the API as they are. */
export const fetchConversations = (
  filters: InboxFilters,
  cursor: string | undefined,
  signal?: AbortSignal,
) =>
  apiFetch('/v2/inbox/conversations', {
    query: {
      limit: CONVERSATIONS_PAGE_SIZE,
      tab: filters.tab,
      status: filters.status === 'default' ? undefined : filters.status,
      q: filters.q.trim() || undefined,
      cursor,
    },
    schema: conversationListResponseSchema,
    signal,
  });

export const fetchConversation = (id: string, signal?: AbortSignal) =>
  apiFetch(`/v2/inbox/conversations/${id}`, { schema: inboxConversationDetailSchema, signal });

/** The newest messages, or the ones before `before` (a message `seq`); each page is ascending by `seq`. */
export const fetchMessages = (id: string, before: number | undefined, signal?: AbortSignal) =>
  apiFetch(`/v2/inbox/conversations/${id}/messages`, {
    query: { limit: MESSAGES_PAGE_SIZE, before },
    schema: messageListResponseSchema,
    signal,
  });

/**
 * Sends a text message. The `clientMessageId` doubles as the idempotency key, so a resend of the same bubble after a dropped
 * connection returns the first message instead of sending twice.
 */
export const sendTextMessage = (id: string, clientMessageId: string, body: string) =>
  apiFetch(`/v2/inbox/conversations/${id}/messages`, {
    method: 'POST',
    body: { kind: 'text', clientMessageId, body },
    idempotencyKey: clientMessageId,
    schema: messageResponseSchema,
  });

export const markConversationRead = (id: string, upToSeq: number) =>
  apiFetch(`/v2/inbox/conversations/${id}/read`, {
    method: 'POST',
    body: { upToSeq },
    schema: markConversationReadResponseSchema,
  });

export const setConversationStatus = (id: string, input: SetConversationStatusInput) =>
  apiFetch(`/v2/inbox/conversations/${id}/status`, {
    method: 'POST',
    body: input,
    schema: conversationSummarySchema,
  });

/** Puts a failed outbound message back in the queue. */
export const retryMessage = (messageId: string) =>
  apiFetch(`/v2/inbox/messages/${messageId}/retry`, {
    method: 'POST',
    schema: messageResponseSchema,
  });

/** What an assignment sends: the version that was read, and who gets the conversation (`null` takes it from them). */
export interface AssignInput {
  rowVersion: number;
  userId?: string | null;
  teamId?: string | null;
}

/**
 * Gives the conversation to someone, or to no one with `userId: null`. A person's own id is a claim, which is all that
 * `inbox.conversation.assign_self` allows. A stale `rowVersion` is 409 ROW_VERSION_CONFLICT.
 */
export const assignConversation = (id: string, input: AssignInput, idempotencyKey?: string) =>
  apiFetch(`/v2/inbox/conversations/${id}/assign`, {
    method: 'POST',
    body: input,
    schema: assignConversationResponseSchema,
    idempotencyKey,
  });
