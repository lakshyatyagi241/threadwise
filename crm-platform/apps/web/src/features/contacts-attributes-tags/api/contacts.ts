'use client';

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiFetch } from '@/lib/api/client';
import {
  contactPageSchema,
  contactResponseSchema,
  contactStatsSchema,
  contactGroupsSchema,
  type ContactPage,
  type ContactRow,
} from './schemas';

export const KEYS = {
  contacts: ['cat', 'contacts'] as const,
  contact: (id: string) => ['cat', 'contact', id] as const,
  contactTags: (id: string) => ['cat', 'contact-tags', id] as const,
  tags: ['cat', 'tags'] as const,
  attributes: ['cat', 'attributes'] as const,
  attributePicker: ['cat', 'attribute-picker'] as const,
  statusOptions: ['cat', 'status-options'] as const,
  groups: ['cat', 'groups'] as const,
  stats: ['cat', 'stats'] as const,
};

/** Rows per screen (the API accepts up to 1000; the footer offers these); ten is the default until one is remembered. */
export const PAGE_SIZES = [10, 25, 50, 100, 200] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export type ConsentFilter = '' | 'subscribed' | 'unsubscribed';

export interface ContactFilters {
  q: string;
  lifecycleStage: string;
  /** Group id, `no_group`, or empty for all. */
  group: string;
  /** Tag id, or empty. */
  tag: string;
  consent: ConsentFilter;
  /** Created by a CSV import (Reference's "Imported" view, which never matched anything there). */
  imported: boolean;
  order: 'asc' | 'desc';
  limit: PageSize;
  /** 1-based page number; it is not part of the saved filter of a bulk action. */
  page: number;
}

export const DEFAULT_FILTERS: ContactFilters = {
  q: '',
  lifecycleStage: '',
  group: '',
  tag: '',
  consent: '',
  imported: false,
  order: 'desc',
  limit: 10,
  page: 1,
};

/** The filter half of a list request, also the saved filter of a bulk action ("select all N matching"). */
export function contactFilterBody(
  f: Pick<ContactFilters, 'q' | 'lifecycleStage' | 'group' | 'tag' | 'consent' | 'imported'>,
) {
  return {
    q: f.q.trim() || undefined,
    lifecycleStage: f.lifecycleStage || undefined,
    groupId: f.group && f.group !== 'no_group' ? f.group : undefined,
    noGroup: f.group === 'no_group' ? true : undefined,
    tagIds: f.tag ? [f.tag] : undefined,
    unsubscribed: f.consent === '' ? undefined : f.consent === 'unsubscribed',
    imported: f.imported ? true : undefined,
  };
}

/** The query string of `GET /contacts`. Rows come with their group and tag chips; the total feeds the tiles. */
export function listQuery(f: ContactFilters) {
  const b = contactFilterBody(f);
  return {
    q: b.q,
    lifecycleStage: b.lifecycleStage,
    groupId: b.groupId,
    noGroup: b.noGroup,
    tagIds: f.tag || undefined,
    unsubscribed: b.unsubscribed,
    imported: b.imported,
    order: f.order,
    limit: f.limit,
    expand: 'groups,tags',
    includeTotal: true,
  };
}

/** One loaded page: the response and the 0-based index it really is (a jump past the end lands on the last page). */
export interface ContactPageResult {
  response: ContactPage;
  index: number;
}

type ListQuery = ReturnType<typeof listQuery>;

const pageKey = (query: ListQuery, index: number) =>
  [...KEYS.contacts, 'page', query, index] as const;

/**
 * Loads page `index` (0-based) of a cursor API. The cursor of page N is the `nextCursor` of page N-1, so each loaded
 * page is cached under its own key and the next call starts from the nearest cached page before the target. Going to
 * the next page or back is one request; jumping ahead walks the pages in between one after another (a cursor cannot
 * be computed), caching each. If the list ends first, the last page is returned with its real index.
 */
export async function loadContactPage(
  qc: QueryClient,
  query: ListQuery,
  index: number,
  signal?: AbortSignal,
): Promise<ContactPageResult> {
  let at = index;
  let cursor: string | undefined;
  for (; at > 0; at--) {
    const prev = qc.getQueryData<ContactPageResult>(pageKey(query, at - 1));
    const next = prev?.response.page;
    if (next?.hasMore && next.nextCursor) {
      cursor = next.nextCursor;
      break;
    }
  }
  for (;;) {
    const response = await apiFetch('/contacts', {
      query: { ...query, cursor },
      schema: contactPageSchema,
      signal,
    });
    const result: ContactPageResult = { response, index: at };
    qc.setQueryData(pageKey(query, at), result);
    if (at >= index || !response.page.hasMore || !response.page.nextCursor) return result;
    cursor = response.page.nextCursor;
    at++;
  }
}

/**
 * One numbered page of contacts (`page` is 1-based) with the total from `includeTotal`. The previous page stays on
 * screen while the next loads, and the page after the current one is fetched ahead.
 */
export function useContactsPage(filters: ContactFilters, page: number) {
  const qc = useQueryClient();
  const query = listQuery(filters);
  const index = Math.max(0, page - 1);
  const q = useQuery({
    queryKey: pageKey(query, index),
    queryFn: ({ signal }) => loadContactPage(qc, query, index, signal),
    placeholderData: keepPreviousData,
  });
  const result = q.data;
  const hasMore = result?.response.page.hasMore ?? false;
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    if (!hasMore || q.isPlaceholderData) return;
    void qc.prefetchQuery({
      queryKey: pageKey(query, index + 1),
      queryFn: ({ signal }) => loadContactPage(qc, query, index + 1, signal),
    });
    // `query` is rebuilt every render; its serialisation is the stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, q.isPlaceholderData, index, queryKey, qc]);
  return {
    ...q,
    items: result?.response.data ?? [],
    /** The page actually shown (1-based); lower than asked for when the list is shorter. */
    page: result ? result.index + 1 : page,
    hasNextPage: hasMore,
    /** Every contact matching the filter, from `meta.total`. */
    total: result?.response.meta?.total,
  };
}

/** Workspace-wide counts for the tiles and the left rail: they ignore the active filter. */
export function useContactStats() {
  return useQuery({
    queryKey: KEYS.stats,
    queryFn: ({ signal }) => apiFetch('/contacts/stats', { schema: contactStatsSchema, signal }),
  });
}

/**
 * One contact with its group chips. `GET /contacts/:id` does not expand them (only the list does), so the groups
 * come from their own call; the form and the detail page both need them to show and edit membership.
 */
export async function fetchContact(id: string, signal?: AbortSignal): Promise<ContactRow> {
  const [contact, groups] = await Promise.all([
    apiFetch(`/contacts/${id}`, { schema: contactResponseSchema, signal }),
    apiFetch(`/contacts/${id}/groups`, { schema: contactGroupsSchema, signal }),
  ]);
  return { ...contact, groups };
}

export function useContact(id: string) {
  return useQuery({
    queryKey: KEYS.contact(id),
    queryFn: ({ signal }) => fetchContact(id, signal),
    retry: false,
  });
}

export const createContact = (body: unknown): Promise<ContactRow> =>
  apiFetch('/contacts', { method: 'POST', body, schema: contactResponseSchema });

export const updateContact = (id: string, body: unknown): Promise<ContactRow> =>
  apiFetch(`/contacts/${id}`, { method: 'PATCH', body, schema: contactResponseSchema });

export const deleteContact = (id: string): Promise<void> =>
  apiFetch(`/contacts/${id}`, { method: 'DELETE' });

export function invalidateContacts(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: KEYS.contacts }),
    qc.invalidateQueries({ queryKey: KEYS.stats }),
  ]);
}
