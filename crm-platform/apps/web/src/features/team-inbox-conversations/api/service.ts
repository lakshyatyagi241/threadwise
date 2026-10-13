import type {
  ApplyConversationLabelInput,
  AssignConversationInput,
  CreateInboxLabelInput,
  UpdateInboxLabelInput,
  BulkConversationsInput,
  CreateConversationNoteInput,
  CreateMessageLogExportInput,
  ConversationPriority,
  CreateSimulatorChannelInput,
  InboxMediaUpload,
  SendMessageInput,
  SimulatorInboundInput,
  SimulatorReceiptInput,
  UpdateChannelInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import { listQuery, type ListFilters } from '../lib/list';
import {
  bulkConversationsResponseSchema,
  inboxLabelListSchema,
  inboxLabelSchema,
  channelListResponseSchema,
  channelResponseSchema,
  conversationEventListResponseSchema,
  conversationGroupMembersSchema,
  conversationListResponseSchema,
  conversationNoteSchema,
  conversationSummarySchema,
  inboxAssigneesResponseSchema,
  inboxConversationDetailSchema,
  inboxCountsSchema,
  inboxMediaUploadSchema,
  inboxTemplateListResponseSchema,
  markConversationReadResponseSchema,
  messageListResponseSchema,
  messageLogExportListSchema,
  messageLogExportSchema,
  messageLogResponseSchema,
  messageResponseSchema,
  noteListSchema,
  simulatorInboundResponseSchema,
} from './schemas';

/** The finished export as a file. It needs the session, so it is fetched (a bare link carries no auth) and the body handed to the browser. */
export async function downloadMessageLogExport(
  exportId: string,
): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetch(`/api/v2/inbox/message-logs/exports/${exportId}/download`, {
    headers: { Accept: 'text/csv', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw toApiError(res.status, body, res.headers.get('x-request-id'));
  }
  const named = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '');
  return { blob: await res.blob(), fileName: named?.[1] ?? 'message-log.csv' };
}

/** Every inbox call. Paths are the plan's endpoint list (section 4.2); the proxy adds the session token. */
export const inboxApi = {
  messageLog: (messageId: string, signal?: AbortSignal) =>
    apiFetch(`/inbox/messages/${messageId}/log`, { schema: messageLogResponseSchema, signal }),
  logExports: (signal?: AbortSignal) =>
    apiFetch('/inbox/message-logs/exports', { schema: messageLogExportListSchema, signal }),
  requestLogExport: (input: CreateMessageLogExportInput) =>
    apiFetch('/inbox/message-logs/exports', {
      method: 'POST',
      body: input,
      schema: messageLogExportSchema,
    }),
  conversations: (filters: ListFilters, cursor: string | null, signal?: AbortSignal) =>
    apiFetch('/inbox/conversations', {
      query: { limit: 30, ...listQuery(filters), cursor: cursor ?? undefined },
      schema: conversationListResponseSchema,
      signal,
    }),
  counts: (signal?: AbortSignal) =>
    apiFetch('/inbox/counts', { schema: inboxCountsSchema, signal }),
  conversation: (id: string, signal?: AbortSignal) =>
    apiFetch(`/inbox/conversations/${id}`, { schema: inboxConversationDetailSchema, signal }),
  messages: (
    id: string,
    query: { before?: number; afterSeq?: number; limit?: number },
    signal?: AbortSignal,
  ) =>
    apiFetch(`/inbox/conversations/${id}/messages`, {
      query,
      schema: messageListResponseSchema,
      signal,
    }),

  /** The Idempotency-Key is the message's own `clientMessageId`, so a repeated request returns the first message. */
  send: (conversationId: string, input: SendMessageInput) =>
    apiFetch(`/inbox/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: input,
      schema: messageResponseSchema,
      idempotencyKey: input.clientMessageId,
    }),
  /** The members of a personal-number group thread, for the composer's @mention picker (read from the directory; `q` is a name or number). */
  groupMembers: (conversationId: string, q: string, signal?: AbortSignal) =>
    apiFetch(`/inbox/conversations/${conversationId}/group-members`, {
      query: { q: q || undefined, limit: 20 },
      schema: conversationGroupMembersSchema,
      signal,
    }),
  /** The approved templates the conversation's WhatsApp number can send (the picker of the composer). */
  templates: (conversationId: string, q: string, signal?: AbortSignal) =>
    apiFetch(`/inbox/conversations/${conversationId}/templates`, {
      query: q ? { q } : {},
      schema: inboxTemplateListResponseSchema,
      signal,
    }),
  retry: (messageId: string) =>
    apiFetch(`/inbox/messages/${messageId}/retry`, {
      method: 'POST',
      schema: messageResponseSchema,
    }),
  markRead: (conversationId: string, upToSeq: number) =>
    apiFetch(`/inbox/conversations/${conversationId}/read`, {
      method: 'POST',
      body: { upToSeq },
      schema: markConversationReadResponseSchema,
    }),
  /** Answers the row as the list shows it after the change. */
  assign: (
    conversationId: string,
    input: Pick<AssignConversationInput, 'rowVersion' | 'userId' | 'teamId'>,
  ) =>
    apiFetch(`/inbox/conversations/${conversationId}/assign`, {
      method: 'POST',
      body: input,
      schema: conversationSummarySchema,
    }),
  setPriority: (conversationId: string, rowVersion: number, priority: ConversationPriority) =>
    apiFetch(`/inbox/conversations/${conversationId}/priority`, {
      method: 'POST',
      body: { rowVersion, priority },
      schema: conversationSummarySchema,
    }),
  snooze: (conversationId: string, rowVersion: number, until: string) =>
    apiFetch(`/inbox/conversations/${conversationId}/snooze`, {
      method: 'POST',
      body: { rowVersion, until },
      schema: conversationSummarySchema,
    }),
  labels: (signal?: AbortSignal) =>
    apiFetch('/inbox/labels', { schema: inboxLabelListSchema, signal }),
  createLabel: (input: CreateInboxLabelInput) =>
    apiFetch('/inbox/labels', { method: 'POST', body: input, schema: inboxLabelSchema }),
  updateLabel: (id: string, input: UpdateInboxLabelInput) =>
    apiFetch(`/inbox/labels/${id}`, { method: 'PATCH', body: input, schema: inboxLabelSchema }),
  deleteLabel: (id: string) => apiFetch(`/inbox/labels/${id}`, { method: 'DELETE' }),
  applyLabel: (conversationId: string, input: ApplyConversationLabelInput) =>
    apiFetch(`/inbox/conversations/${conversationId}/labels`, {
      method: 'POST',
      body: input,
      schema: conversationSummarySchema,
    }),
  withdrawLabel: (conversationId: string, tagId: string) =>
    apiFetch(`/inbox/conversations/${conversationId}/labels/${tagId}`, {
      method: 'DELETE',
      schema: conversationSummarySchema,
    }),
  /** One action on up to 200 conversations; the answer names each one's outcome. */
  bulk: (input: BulkConversationsInput) =>
    apiFetch('/inbox/conversations/bulk', {
      method: 'POST',
      body: input,
      schema: bulkConversationsResponseSchema,
    }),
  setStatus: (conversationId: string, rowVersion: number, status: 'open' | 'resolved') =>
    apiFetch(`/inbox/conversations/${conversationId}/status`, {
      method: 'POST',
      body: { rowVersion, status },
    }),

  notes: (conversationId: string, signal?: AbortSignal) =>
    apiFetch(`/inbox/conversations/${conversationId}/notes`, {
      query: { limit: 100 },
      schema: noteListSchema,
      signal,
    }),
  addNote: (conversationId: string, input: CreateConversationNoteInput) =>
    apiFetch(`/inbox/conversations/${conversationId}/notes`, {
      method: 'POST',
      body: input,
      schema: conversationNoteSchema,
    }),
  deleteNote: (conversationId: string, noteId: string) =>
    apiFetch(`/inbox/conversations/${conversationId}/notes/${noteId}`, { method: 'DELETE' }),
  events: (conversationId: string, signal?: AbortSignal) =>
    apiFetch(`/inbox/conversations/${conversationId}/events`, {
      query: { limit: 100 },
      schema: conversationEventListResponseSchema,
      signal,
    }),
  assignees: (signal?: AbortSignal) =>
    apiFetch('/inbox/assignees', { schema: inboxAssigneesResponseSchema, signal }),

  // --- channels and the dev simulator ---
  channels: (signal?: AbortSignal) =>
    apiFetch('/channels', { schema: channelListResponseSchema, signal }),
  createSimulatorChannel: (input: CreateSimulatorChannelInput) =>
    apiFetch('/channels/simulator', {
      method: 'POST',
      body: input,
      schema: channelResponseSchema,
    }),
  updateChannel: (id: string, input: UpdateChannelInput) =>
    apiFetch(`/channels/${id}`, { method: 'PATCH', body: input, schema: channelResponseSchema }),
  deleteChannel: (id: string) => apiFetch(`/channels/${id}`, { method: 'DELETE' }),
  simulatorInbound: (channelId: string, input: SimulatorInboundInput) =>
    apiFetch(`/dev/simulator/channels/${channelId}/inbound`, {
      method: 'POST',
      body: input,
      schema: simulatorInboundResponseSchema,
    }),
  simulatorReceipt: (channelId: string, input: SimulatorReceiptInput) =>
    apiFetch(`/dev/simulator/channels/${channelId}/receipt`, { method: 'POST', body: input }),
};

/**
 * Uploads one attachment ahead of the send (`POST /inbox/media`). Multipart over XMLHttpRequest because fetch cannot report
 * upload progress. The answer names the stored file; the send then refers to it by id.
 */
export function uploadMedia(
  file: File,
  onProgress: (percent: number) => void,
): Promise<InboxMediaUpload> {
  return new Promise<InboxMediaUpload>((resolve, reject) => {
    const form = new FormData();
    form.set('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v2/inbox/media');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Idempotency-Key', crypto.randomUUID());
    xhr.setRequestHeader('X-Request-Id', crypto.randomUUID());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new TypeError('network'));
    xhr.onload = () => {
      let json: unknown;
      try {
        json = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        json = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = inboxMediaUploadSchema.safeParse(json);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error('unexpected response'));
        return;
      }
      reject(toApiError(xhr.status, json, xhr.getResponseHeader('x-request-id')));
    };
    xhr.send(form);
  });
}
