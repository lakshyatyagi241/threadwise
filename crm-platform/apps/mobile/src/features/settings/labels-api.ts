import {
  inboxTagListSchema,
  inboxTagSchema,
  type CreateInboxTagInput,
  type UpdateInboxTagInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * The calls behind Settings, Labels (the web's "Conversation tags", `/inbox/tags`): the workspace's label library. Reading needs
 * `inbox.conversation.read`; adding, renaming, recolouring and deleting need `inbox.tag.manage`. The labels are the same rows the web
 * calls tags (and contacts carry them too), so a deletion also takes the label off contacts.
 */

/** Every label with how many conversations carry it. The library is small and comes whole, in one answer. */
export const fetchLabelList = (signal?: AbortSignal) =>
  apiFetch('/v2/inbox/labels', { schema: inboxTagListSchema, signal });

export const createLabel = (body: CreateInboxTagInput) =>
  apiFetch('/v2/inbox/labels', { method: 'POST', body, schema: inboxTagSchema });

/** Sends the version that was read; a stale one is 409 ROW_VERSION_CONFLICT. */
export const updateLabel = (id: string, body: UpdateInboxTagInput) =>
  apiFetch(`/v2/inbox/labels/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    schema: inboxTagSchema,
  });

export const deleteLabel = (id: string) =>
  apiFetch(`/v2/inbox/labels/${encodeURIComponent(id)}`, { method: 'DELETE' });
