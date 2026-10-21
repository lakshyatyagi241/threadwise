import {
  assignConversationResponseSchema,
  channelListResponseSchema,
  conversationListResponseSchema,
  conversationSummarySchema,
  inboxAssigneesResponseSchema,
  inboxConversationDetailSchema,
  inboxMediaUploadSchema,
  inboxTemplateListResponseSchema,
  markConversationReadResponseSchema,
  messageListResponseSchema,
  messageResponseSchema,
  type MarkSpamConversationInput,
  type SetConversationPriorityInput,
  type SetConversationStatusInput,
  type SnoozeConversationInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';
import type { PickedAttachment } from './attachment';
import type { InboxFilters } from './filters';

export const CONVERSATIONS_PAGE_SIZE = 20;
export const MESSAGES_PAGE_SIZE = 30;

/** One page of the conversation list (WD-INBOX): the tab, the status, channel, labels, archive view and the search words go to the API as they are. */
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
      channelId: filters.channelId || undefined,
      labels: filters.labels.length > 0 ? filters.labels.join(',') : undefined,
      agentIds: filters.agentIds.length > 0 ? filters.agentIds.join(',') : undefined,
      sort: filters.sort === 'recent' ? undefined : filters.sort,
      archived: filters.archived ? 'true' : undefined,
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

/**
 * How long an upload may take: two minutes, plus what the file needs at a slow 1 Mbit/s (about 128 KB a second), at most twenty
 * minutes. A fixed short limit would cut a large document on a mobile connection off every time; the person can cancel meanwhile.
 */
export const uploadTimeoutMs = (sizeBytes: number | null): number =>
  Math.min(20 * 60_000, 120_000 + Math.ceil(((sizeBytes ?? 0) / (128 * 1024)) * 1000));

/**
 * Puts a file on the server before the message that carries it (`POST /inbox/media`, multipart field `file`). The answer's `id` is what
 * the media message names. The server checks the type by content and the size by kind; the same `idempotencyKey` repeats the same upload.
 */
export const uploadInboxMedia = (
  file: PickedAttachment,
  idempotencyKey: string,
  signal?: AbortSignal,
) => {
  const form = new FormData();
  // React Native reads the file from its address when the request is sent; this object form is how it is told what to read.
  form.append('file', { uri: file.uri, name: file.name, type: file.mime } as unknown as Blob);
  return apiFetch('/v2/inbox/media', {
    method: 'POST',
    formData: form,
    idempotencyKey,
    timeoutMs: uploadTimeoutMs(file.sizeBytes),
    schema: inboxMediaUploadSchema,
    signal,
  });
};

/** Sends an uploaded file as a message, with an optional caption. Like a text, the `clientMessageId` is the idempotency key. */
export const sendMediaMessage = (
  id: string,
  clientMessageId: string,
  mediaId: string,
  caption: string,
) =>
  apiFetch(`/v2/inbox/conversations/${id}/messages`, {
    method: 'POST',
    body: {
      kind: 'media',
      clientMessageId,
      mediaId,
      ...(caption.trim() ? { caption: caption.trim() } : {}),
    },
    idempotencyKey: clientMessageId,
    schema: messageResponseSchema,
  });

/**
 * The approved templates this conversation's WhatsApp number can send, narrowed by the search words. A template the app cannot fill
 * in yet comes back with `sendable: false` and the reason, so the picker can say why it is greyed out.
 */
export const fetchInboxTemplates = (id: string, q: string, signal?: AbortSignal) =>
  apiFetch(`/v2/inbox/conversations/${id}/templates`, {
    query: { q: q.trim() || undefined },
    schema: inboxTemplateListResponseSchema,
    signal,
  });

/** Sends a template with the values for its `{{n}}` slots (by slot key). Allowed when the 24-hour window is closed; same idempotency as a text. */
export const sendTemplateMessage = (
  id: string,
  clientMessageId: string,
  templateId: string,
  variables: Record<string, string>,
) =>
  apiFetch(`/v2/inbox/conversations/${id}/messages`, {
    method: 'POST',
    body: { kind: 'template', clientMessageId, templateId, variables },
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

/** The people and teams a conversation can be given to, with how many open conversations each person has right now. */
export const fetchAssignees = (signal?: AbortSignal) =>
  apiFetch('/v2/inbox/assignees', { schema: inboxAssigneesResponseSchema, signal });

/** Low, normal, high or urgent (`inbox.conversation.priority`). A stale `rowVersion` is 409 ROW_VERSION_CONFLICT. */
export const setConversationPriority = (id: string, input: SetConversationPriorityInput) =>
  apiFetch(`/v2/inbox/conversations/${id}/priority`, {
    method: 'POST',
    body: input,
    schema: conversationSummarySchema,
  });

/**
 * Parks an open or pending conversation until a time (`inbox.conversation.snooze`); it reopens by itself. To wake it sooner, move
 * it to open with the status route.
 */
export const snoozeConversation = (id: string, input: SnoozeConversationInput) =>
  apiFetch(`/v2/inbox/conversations/${id}/snooze`, {
    method: 'POST',
    body: input,
    schema: conversationSummarySchema,
  });

/**
 * Marks the conversation as spam from any status (`inbox.conversation.resolve`); it leaves the live lists. Taking it off spam is the
 * status route (spam to open). A stale `rowVersion` is 409 ROW_VERSION_CONFLICT.
 */
export const markConversationSpam = (
  id: string,
  input: MarkSpamConversationInput,
  idempotencyKey?: string,
) =>
  apiFetch(`/v2/inbox/conversations/${id}/spam`, {
    method: 'POST',
    body: input,
    idempotencyKey,
    schema: conversationSummarySchema,
  });

/** The channels the workspace has connected (`inbox.conversation.read`): what the list can be narrowed to. */
export const fetchChannels = (signal?: AbortSignal) =>
  apiFetch('/v2/channels', { schema: channelListResponseSchema, signal });
