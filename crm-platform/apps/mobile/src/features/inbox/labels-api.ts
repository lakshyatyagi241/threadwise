import { conversationSummarySchema, inboxTagListSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * Labels are on the conversation, as in the reference's inbox (`/v2/inbox/tags*` and `/v2/inbox/conversations/:id/tags*`; the web renamed labels to tags and kept `/labels*` as aliases).
 * The workspace has one label library that contacts share, but a label put on a thread is not a tag on the contact. These are the
 * calls behind the "Assign labels" sheet of a thread.
 */

/** Every label of the workspace (`inbox.conversation.read`), with how many conversations carry it. */
export const fetchLabelLibrary = async (signal?: AbortSignal) =>
  (await apiFetch('/v2/inbox/tags', { schema: inboxTagListSchema, signal })).data;

/**
 * Puts a label on the conversation, by id or by name; the answer is the conversation as it is now. A name that matches no label
 * makes one, which also needs `inbox.tag.manage` (403 INBOX_LABEL_CREATE_FORBIDDEN). Putting on a label already there changes
 * nothing.
 */
export const applyLabel = (
  conversationId: string,
  label: { tagId: string } | { name: string },
  idempotencyKey?: string,
) =>
  apiFetch(`/v2/inbox/conversations/${conversationId}/tags`, {
    method: 'POST',
    body: label,
    schema: conversationSummarySchema,
    idempotencyKey,
  });

/** Takes a label off the conversation (`inbox.conversation.tag`); a label that is not on it changes nothing. */
export const withdrawLabel = (conversationId: string, tagId: string) =>
  apiFetch(`/v2/inbox/conversations/${conversationId}/tags/${tagId}`, {
    method: 'DELETE',
    schema: conversationSummarySchema,
  });
