import { z } from 'zod';
import {
  tchatActivityResponseSchema,
  tchatChannelListResponseSchema,
  tchatChannelMemberSchema,
  tchatChannelResponseSchema,
  tchatInvitationListResponseSchema,
  tchatMemberListResponseSchema,
  tchatMessageListResponseSchema,
  tchatMessageResponseSchema,
  tchatReactionSchema,
  createTchatInvitationResultSchema,
  type CreateTchatChannelInput,
  type CreateTchatInvitationInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';

const base = '/team-chat';
const reactResultSchema = z.object({
  reacted: z.boolean(),
  reactions: z.array(tchatReactionSchema),
});
const okSchema = z.object({ ok: z.literal(true) });
const channelMembersSchema = z.object({ data: z.array(tchatChannelMemberSchema) });
const messagesOnlySchema = z.object({ data: z.array(tchatMessageResponseSchema) });

/** Every team-chat call. Routes name channels and messages by uuid; the proxy adds the session token. */
export const chatApi = {
  channels: (signal?: AbortSignal) =>
    apiFetch(`${base}/channels`, { schema: tchatChannelListResponseSchema, signal }),
  roster: (signal?: AbortSignal) =>
    apiFetch(`${base}/members`, { schema: tchatMemberListResponseSchema, signal }),
  createChannel: (input: CreateTchatChannelInput) =>
    apiFetch(`${base}/channels`, {
      method: 'POST',
      body: input,
      schema: tchatChannelResponseSchema,
    }),
  deleteChannel: (id: string) => apiFetch(`${base}/channels/${id}`, { method: 'DELETE' }),
  openDirect: (userId: string) =>
    apiFetch(`${base}/dm`, {
      method: 'POST',
      body: { userId },
      schema: tchatChannelResponseSchema,
    }),
  channelMembers: (id: string, signal?: AbortSignal) =>
    apiFetch(`${base}/channels/${id}/members`, { schema: channelMembersSchema, signal }),
  addChannelMember: (id: string, userId: string) =>
    apiFetch(`${base}/channels/${id}/members`, { method: 'POST', body: { userId } }),
  removeChannelMember: (id: string, userId: string) =>
    apiFetch(`${base}/channels/${id}/members/${userId}`, { method: 'DELETE' }),

  /** Newest page (ascending), or older with `before`, or only newer with `after`. */
  messages: (
    channelId: string,
    query: { before?: string; after?: string; limit?: number },
    signal?: AbortSignal,
  ) =>
    apiFetch(`${base}/channels/${channelId}/messages`, {
      query,
      schema: tchatMessageListResponseSchema,
      signal,
    }),
  pinned: (channelId: string, signal?: AbortSignal) =>
    apiFetch(`${base}/channels/${channelId}/pinned`, { schema: messagesOnlySchema, signal }),
  search: (channelId: string, q: string, signal?: AbortSignal) =>
    apiFetch(`${base}/channels/${channelId}/search`, {
      query: { q },
      schema: messagesOnlySchema,
      signal,
    }),
  markRead: (channelId: string, lastMessageId?: string) =>
    apiFetch(`${base}/channels/${channelId}/read`, {
      method: 'POST',
      body: lastMessageId ? { lastMessageId } : {},
      schema: okSchema,
    }),
  typing: (channelId: string) =>
    apiFetch(`${base}/channels/${channelId}/typing`, { method: 'POST', schema: okSchema }),
  presence: () => apiFetch(`${base}/presence`, { method: 'POST', schema: okSchema }),
  activity: (channelId: string, signal?: AbortSignal) =>
    apiFetch(`${base}/channels/${channelId}/activity`, {
      schema: tchatActivityResponseSchema,
      signal,
    }),

  edit: (id: string, body: string, rowVersion: number) =>
    apiFetch(`${base}/messages/${id}`, {
      method: 'PATCH',
      body: { body, rowVersion },
      schema: tchatMessageResponseSchema,
    }),
  remove: (id: string) => apiFetch(`${base}/messages/${id}`, { method: 'DELETE' }),
  pin: (id: string) =>
    apiFetch(`${base}/messages/${id}/pin`, {
      method: 'POST',
      schema: z.object({ pinned: z.boolean() }),
    }),
  react: (id: string, emoji: string) =>
    apiFetch(`${base}/messages/${id}/reactions`, {
      method: 'POST',
      body: { emoji },
      schema: reactResultSchema,
    }),

  invitations: (signal?: AbortSignal) =>
    apiFetch(`${base}/invitations`, { schema: tchatInvitationListResponseSchema, signal }),
  invite: (input: CreateTchatInvitationInput) =>
    apiFetch(`${base}/invitations`, {
      method: 'POST',
      body: input,
      schema: createTchatInvitationResultSchema,
    }),
  decide: (id: string, decision: 'approve' | 'decline') =>
    apiFetch(`${base}/invitations/${id}/${decision}`, { method: 'POST', schema: okSchema }),
};

export interface SendInput {
  channelId: string;
  body: string;
  replyToId: string | null;
  file: File | null;
  /** The Idempotency-Key. */
  key: string;
}

/**
 * Posts a message. With a file it is multipart over XMLHttpRequest (fetch cannot report upload progress); without one it is
 * plain JSON. The key is the same on a retry, so a response lost on the way can never become two messages.
 */
export function sendMessage(input: SendInput, onProgress: (percent: number) => void) {
  const path = `${base}/channels/${input.channelId}/messages`;
  if (!input.file) {
    return apiFetch(path, {
      method: 'POST',
      body: {
        ...(input.body ? { body: input.body } : {}),
        ...(input.replyToId ? { replyToId: input.replyToId } : {}),
      },
      schema: tchatMessageResponseSchema,
      idempotencyKey: input.key,
    });
  }
  return new Promise<z.infer<typeof tchatMessageResponseSchema>>((resolve, reject) => {
    const form = new FormData();
    if (input.body) form.set('body', input.body);
    if (input.replyToId) form.set('replyToId', input.replyToId);
    form.set('attachment', input.file!);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v2${path}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Idempotency-Key', input.key);
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
        const parsed = tchatMessageResponseSchema.safeParse(json);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error('unexpected response'));
        return;
      }
      reject(toApiError(xhr.status, json, xhr.getResponseHeader('x-request-id')));
    };
    xhr.send(form);
  });
}
