'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import type { FollowUpFilter } from '@crm/contracts';
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
  filterValues: ['cat', 'contact-filter-values'] as const,
  owners: ['cat', 'owners'] as const,
};

/** Rows per screen (the API accepts up to 1000; the footer offers these); fifty is the default until one is remembered. */
export const PAGE_SIZES = [10, 25, 50, 100, 200] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export type ConsentFilter = '' | 'subscribed' | 'unsubscribed';
export type MinorFilter = '' | 'yes' | 'no';

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
  /** One contact status value (`status` on the API), empty for any. */
  status: string;
  /** `yes`: flagged as a minor only; `no`: not flagged; empty for both (`minor` on the API, BL-190). */
  minor: MinorFilter;
  /** Where the contact's next follow-up stands now (`followUp` on the API, BL-291), empty for any. */
  followUp: '' | FollowUpFilter;
  /** Where the contact came from (`source` on the API: the import's source knob, a form, "api"), empty for any. */
  source: string;
  /** Members of one segment (a saved rule that fills itself), by id; empty for none. Combines with every other filter. */
  segment: string;
  /**
   * Owners to show: person ids and/or `none` (contacts nobody owns), comma-separated, in the order picked; empty for everyone.
   * Several mean "any of them".
   */
  owner: string;
  /** Ad-hoc conditions (a segment's rule tree as JSON text) from the Hub's "Add condition"; empty for none. */
  rules: string;
  order: 'asc' | 'desc';
  /** What `order` applies to: `createdAt` (the default, newest first), a column id the API sorts by, or `attr:<key>`. */
  sort: string;
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
  status: '',
  minor: '',
  followUp: '',
  source: '',
  segment: '',
  owner: '',
  rules: '',
  order: 'desc',
  sort: 'createdAt',
  limit: 50,
  page: 1,
};

/** The filter half of a list request, also the saved filter of a bulk action ("select all N matching"). */
export function contactFilterBody(
  f: Pick<
    ContactFilters,
    'q' | 'lifecycleStage' | 'group' | 'tag' | 'consent' | 'imported' | 'segment'
  > & {
    rules?: string;
    owner?: string;
    status?: string;
    source?: string;
    minor?: MinorFilter;
    followUp?: '' | FollowUpFilter;
  },
) {
  const owners = ownerTokens(f.owner ?? '');
  const ownerIds = owners.filter((o) => o !== UNASSIGNED_OWNER);
  return {
    q: f.q.trim() || undefined,
    lifecycleStage: f.lifecycleStage || undefined,
    groupId: f.group && f.group !== 'no_group' ? f.group : undefined,
    noGroup: f.group === 'no_group' ? true : undefined,
    tagIds: f.tag ? [f.tag] : undefined,
    // "Subscribed" is the list's WhatsApp opt-in column (label subscribed, not opted out), not merely "has not opted out".
    unsubscribed: f.consent === 'unsubscribed' ? true : undefined,
    subscribed: f.consent === 'subscribed' ? true : undefined,
    imported: f.imported ? true : undefined,
    status: f.status?.trim() || undefined,
    minor: f.minor ? f.minor === 'yes' : undefined,
    followUp: f.followUp || undefined,
    source: f.source?.trim() || undefined,
    segmentId: f.segment || undefined,
    rules: f.rules || undefined,
    ownerIds: ownerIds.length > 0 ? ownerIds : undefined,
    unassigned: owners.includes(UNASSIGNED_OWNER) ? true : undefined,
  };
}

/** The `none` token of the owner filter: contacts with no owner. */
export const UNASSIGNED_OWNER = 'none';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The distinct, valid tokens of an owner filter value (a person's uuid or `none`), in order; anything else is dropped. */
export function ownerTokens(value: string): string[] {
  const out: string[] = [];
  for (const raw of value.split(',')) {
    const t = raw.trim().toLowerCase();
    if ((t === UNASSIGNED_OWNER || UUID_RE.test(t)) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 50);
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
    subscribed: b.subscribed,
    imported: b.imported,
    status: b.status,
    minor: b.minor,
    followUp: b.followUp,
    source: b.source,
    segmentId: b.segmentId,
    rules: b.rules,
    ownerIds: b.ownerIds?.join(','),
    unassigned: b.unassigned,
    order: f.order,
    sort: f.sort === 'createdAt' ? undefined : f.sort,
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
    /** The total is an estimate (a segment too large to count in time). */
    totalApproximate: result?.response.meta?.approximate ?? false,
    /** Only when the list is filtered by a segment: how many of its conditions point at something deleted. */
    segmentInvalid: result?.response.segment?.invalidConditions.length ?? 0,
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

export function useContact(id: string, enabled = true) {
  return useQuery({
    queryKey: KEYS.contact(id),
    queryFn: ({ signal }) => fetchContact(id, signal),
    enabled,
    retry: false,
  });
}

export const createContact = (body: unknown): Promise<ContactRow> =>
  apiFetch('/contacts', { method: 'POST', body, schema: contactResponseSchema });

export const updateContact = (id: string, body: unknown): Promise<ContactRow> =>
  apiFetch(`/contacts/${id}`, { method: 'PATCH', body, schema: contactResponseSchema });

/**
 * Deleting a contact erases their conversations, messages, media, files, call recordings and call logs (leads, deals, tasks and
 * invoices stay). `eraseHistory: false` keeps the conversations without the person's identity; absent means erase.
 */
export const deleteContact = (id: string, opts: { eraseHistory?: boolean } = {}): Promise<void> =>
  apiFetch(`/contacts/${id}`, {
    method: 'DELETE',
    query: opts.eraseHistory === false ? { eraseHistory: false } : undefined,
  });

export function invalidateContacts(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: KEYS.contacts }),
    qc.invalidateQueries({ queryKey: KEYS.stats }),
    qc.invalidateQueries({ queryKey: KEYS.filterValues }),
  ]);
}

/** Contacts shown per column of the stage board before "Load more". */
export const BOARD_PAGE = 20;

/**
 * One column of the stage board: the contacts in `stage` that match the other filters (search, tag, group, consent...),
 * a page at a time with "load more", and the column's own total. The stage filter itself is ignored: every column is one.
 */
export function useStageColumn(filters: ContactFilters, stage: string) {
  const base = listQuery({ ...filters, lifecycleStage: stage, page: 1 });
  const query = { ...base, limit: BOARD_PAGE };
  return useInfiniteQuery({
    queryKey: [...KEYS.contacts, 'board', stage, query] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/contacts', {
        query: { ...query, cursor: pageParam },
        schema: contactPageSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore && last.page.nextCursor ? last.page.nextCursor : undefined,
    placeholderData: keepPreviousData,
  });
}
