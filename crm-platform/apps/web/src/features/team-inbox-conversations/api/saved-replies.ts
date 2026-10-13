'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type QueryClient,
} from '@tanstack/react-query';
import {
  savedReplyImportResultSchema,
  savedReplyListResponseSchema,
  savedReplySchema,
  useSavedReplyResponseSchema,
  type CreateSavedReplyInput,
  type ListSavedRepliesQuery,
  type SavedReplyImportOptions,
  type SavedReplyImportResult,
  type UpdateSavedReplyInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';

export const SAVED_REPLY_KEYS = {
  all: ['saved-replies'] as const,
  list: (scope: string, q: string, category: string) =>
    ['saved-replies', 'list', scope, q, category] as const,
  picker: (channelKind: string, q: string) => ['saved-replies', 'picker', channelKind, q] as const,
};

/** The most replies the composer's picker asks for at once; typing narrows it on the server. */
export const PICKER_PAGE = 20;
const SCREEN_PAGE = 50;

type Filters = Partial<Pick<ListSavedRepliesQuery, 'q' | 'scope' | 'channelKind' | 'category'>>;

/** Every call of the saved-replies screens and the composer picker. Replies are named by uuid. */
export const savedRepliesApi = {
  list: (f: Filters, limit: number, cursor: string | undefined, signal?: AbortSignal) =>
    apiFetch('/inbox/saved-replies', {
      query: {
        q: f.q || undefined,
        scope: f.scope && f.scope !== 'all' ? f.scope : undefined,
        channelKind: f.channelKind,
        category: f.category || undefined,
        limit,
        cursor,
      },
      schema: savedReplyListResponseSchema,
      signal,
    }),
  get: (id: string, signal?: AbortSignal) =>
    apiFetch(`/inbox/saved-replies/${encodeURIComponent(id)}`, {
      schema: savedReplySchema,
      signal,
    }),
  create: (input: CreateSavedReplyInput) =>
    apiFetch('/inbox/saved-replies', { method: 'POST', body: input, schema: savedReplySchema }),
  update: (id: string, input: UpdateSavedReplyInput) =>
    apiFetch(`/inbox/saved-replies/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      schema: savedReplySchema,
    }),
  remove: (id: string) =>
    apiFetch(`/inbox/saved-replies/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  duplicate: (id: string) =>
    apiFetch(`/inbox/saved-replies/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      schema: savedReplySchema,
    }),
  /** Fills the reply in for this conversation and counts the use. Sends nothing. */
  use: (id: string, conversationId: string) =>
    apiFetch(`/inbox/saved-replies/${encodeURIComponent(id)}/use`, {
      method: 'POST',
      body: { conversationId },
      schema: useSavedReplyResponseSchema,
    }),
};

/** The shared library as a CSV file. */
export async function exportSavedReplies(): Promise<Blob> {
  const res = await fetch('/api/v2/inbox/saved-replies/export', {
    headers: { Accept: 'text/csv', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const text = await res.text();
    throw toApiError(
      res.status,
      text ? JSON.parse(text) : undefined,
      res.headers.get('x-request-id'),
    );
  }
  return res.blob();
}

/** Checks (`dryRun`) or imports a CSV of shared replies. A check writes nothing. */
export async function importSavedReplies(
  file: File,
  options: SavedReplyImportOptions,
): Promise<SavedReplyImportResult> {
  const form = new FormData();
  form.set('file', file);
  form.set('options', JSON.stringify(options));
  const res = await fetch('/api/v2/inbox/saved-replies/import', {
    method: 'POST',
    body: form,
    headers: {
      Accept: 'application/json',
      'X-Request-Id': crypto.randomUUID(),
      'Idempotency-Key': crypto.randomUUID(),
    },
    credentials: 'same-origin',
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return savedReplyImportResultSchema.parse(json);
}

export const refreshSavedReplies = (qc: QueryClient) =>
  qc.invalidateQueries({ queryKey: SAVED_REPLY_KEYS.all });

/** The Settings screen's list: a page at a time ("Load more"), searched and filtered by the server. */
export function useSavedReplyList(
  filters: { scope: 'all' | 'shared' | 'mine'; q: string; category: string },
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: SAVED_REPLY_KEYS.list(filters.scope, filters.q, filters.category),
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      savedRepliesApi.list(
        {
          q: filters.q || undefined,
          scope: filters.scope,
          category: filters.category || undefined,
        },
        SCREEN_PAGE,
        pageParam,
        signal,
      ),
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
}

/** The composer picker's rows: the most used replies for this channel kind, or what the search matches. */
export function usePickerReplies(channelKind: string | undefined, q: string, enabled: boolean) {
  return useQuery({
    queryKey: SAVED_REPLY_KEYS.picker(channelKind ?? '', q),
    enabled,
    retry: false,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      savedRepliesApi.list(
        { q: q || undefined, channelKind: channelKind as ListSavedRepliesQuery['channelKind'] },
        PICKER_PAGE,
        undefined,
        signal,
      ),
  });
}
