'use client';

import { useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import {
  contactPageSchema,
  contactResponseSchema,
  contactStatsSchema,
  contactGroupsSchema,
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

/** Reference's page sizes (the API accepts any size up to 1000). */
export const PAGE_SIZES = [12, 25, 50, 100, 500, 1000] as const;
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
}

export const DEFAULT_FILTERS: ContactFilters = {
  q: '',
  lifecycleStage: '',
  group: '',
  tag: '',
  consent: '',
  imported: false,
  order: 'desc',
  limit: 25,
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

export function useContactsList(filters: ContactFilters) {
  const query = listQuery(filters);
  const q = useInfiniteQuery({
    queryKey: [...KEYS.contacts, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/contacts', {
        query: { ...query, cursor: pageParam },
        schema: contactPageSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  const pages = q.data?.pages ?? [];
  return {
    ...q,
    items: pages.flatMap((p) => p.data),
    /** Every contact matching the filter, from the first page's `meta.total`. */
    total: pages[0]?.meta?.total,
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
