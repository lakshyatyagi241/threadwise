import {
  savedReplyListResponseSchema,
  savedReplySchema,
  type CreateSavedReplyInput,
  type SavedReplyScope,
  type UpdateSavedReplyInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * The calls behind Settings, Quick replies (the web's "Saved replies", TW-TIB1-024): the workspace's library of reusable replies. Every
 * call needs `inbox.savedreply.manage`. Request shapes and answers come from `@crm/contracts`, which also holds the shortcut and
 * variable rules, so the app and the server cannot drift apart.
 */

export const QUICK_REPLIES_PAGE_SIZE = 30;

export type ScopeFilter = 'all' | SavedReplyScope;

/** One page of replies, newest first as the server orders them, with the counts of each scope and the plan's limit. */
export const fetchQuickReplies = (
  filters: { scope: ScopeFilter; q: string },
  cursor: string | undefined,
  signal?: AbortSignal,
) =>
  apiFetch('/v2/inbox/saved-replies', {
    query: {
      scope: filters.scope === 'all' ? undefined : filters.scope,
      q: filters.q.trim() || undefined,
      limit: QUICK_REPLIES_PAGE_SIZE,
      cursor,
    },
    schema: savedReplyListResponseSchema,
    signal,
  });

export const fetchQuickReply = (id: string, signal?: AbortSignal) =>
  apiFetch(`/v2/inbox/saved-replies/${encodeURIComponent(id)}`, {
    schema: savedReplySchema,
    signal,
  });

export const createQuickReply = (body: CreateSavedReplyInput) =>
  apiFetch('/v2/inbox/saved-replies', { method: 'POST', body, schema: savedReplySchema });

/** Sends only what the form holds with the version that was read; a stale one is 409 ROW_VERSION_CONFLICT. */
export const updateQuickReply = (id: string, body: UpdateSavedReplyInput) =>
  apiFetch(`/v2/inbox/saved-replies/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    schema: savedReplySchema,
  });

export const deleteQuickReply = (id: string) =>
  apiFetch(`/v2/inbox/saved-replies/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Makes a copy of a reply (its shortcut gets a numbered suffix) and answers with the copy. */
export const duplicateQuickReply = (id: string) =>
  apiFetch(`/v2/inbox/saved-replies/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
    schema: savedReplySchema,
  });
