'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type QueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { chunk } from '../lib/selection';
import {
  companyActivityPageSchema,
  companyBulkResultSchema,
  companyContactsPageSchema,
  companyIndustriesResponseSchema,
  companyPageResponseSchema,
  companyResponseSchema,
  companySelectItemSchema,
  companyStatsResponseSchema,
  contactHitPageSchema,
  dealResponseSchema,
  memberPageSchema,
  type BulkOutcome,
  type CompanyBulkResult,
  type CompanyResponse,
  type ContactHit,
  type CreateCompanyInput,
  type Member,
  type UpdateCompanyInput,
} from './schemas';

type Query = Record<string, string | number | boolean | undefined>;

export const KEYS = {
  all: ['companies'] as const,
  list: ['companies', 'list'] as const,
  stats: ['companies', 'stats'] as const,
  industries: ['companies', 'industries'] as const,
  company: (id: string) => ['companies', 'company', id] as const,
  contacts: (id: string) => ['companies', 'contacts', id] as const,
  deals: (id: string) => ['companies', 'deals', id] as const,
  activity: (id: string) => ['companies', 'activity', id] as const,
  members: ['companies', 'members'] as const,
  picker: ['companies', 'picker'] as const,
};

const outcome = (r: CompanyBulkResult): BulkOutcome => ({
  changed: r.succeeded.length,
  failed: r.failed.length,
});

const sum = (results: readonly CompanyBulkResult[]): BulkOutcome =>
  results
    .map(outcome)
    .reduce((a, b) => ({ changed: a.changed + b.changed, failed: a.failed + b.failed }), {
      changed: 0,
      failed: 0,
    });

/** Every companies call, one function each. Reads are parsed with the shared contracts. */
export const companiesApi = {
  get: (id: string, signal?: AbortSignal) =>
    apiFetch(`/companies/${id}`, { schema: companyResponseSchema, signal }),
  create: (body: CreateCompanyInput) =>
    apiFetch('/companies', { method: 'POST', body, schema: companyResponseSchema }),
  /** Needs the `rowVersion` that was read; a 409 means someone else changed the company. */
  update: (id: string, body: UpdateCompanyInput) =>
    apiFetch(`/companies/${id}`, { method: 'PATCH', body, schema: companyResponseSchema }),
  remove: (id: string): Promise<void> => apiFetch(`/companies/${id}`, { method: 'DELETE' }),
  async bulkDelete(ids: readonly string[]): Promise<BulkOutcome> {
    return sum(
      await Promise.all(
        chunk(ids, 100).map((c) =>
          apiFetch('/companies/bulk/delete', {
            method: 'POST',
            body: { ids: c },
            schema: companyBulkResultSchema,
          }),
        ),
      ),
    );
  },
  linkContacts: (id: string, contactIds: readonly string[]): Promise<CompanyBulkResult> =>
    apiFetch(`/companies/${id}/contacts`, {
      method: 'POST',
      body: { contactIds },
      schema: companyBulkResultSchema,
    }),
  unlinkContact: (id: string, contactId: string): Promise<void> =>
    apiFetch(`/companies/${id}/contacts/${contactId}`, { method: 'DELETE' }),
  async members(signal?: AbortSignal): Promise<Member[]> {
    const page = await apiFetch('/users', {
      query: { limit: 200 },
      schema: memberPageSchema,
      signal,
    });
    return page.data;
  },
  async searchContacts(q: string, signal?: AbortSignal): Promise<ContactHit[]> {
    const page = await apiFetch('/contacts', {
      query: { q: q.trim() || undefined, limit: 15 },
      schema: contactHitPageSchema,
      signal,
    });
    return page.data;
  },
};

const PAGE_SIZE = 50;

/** The list: every company that passes the query, "load more" by cursor. */
export function useCompaniesList(query: Query) {
  const q = useInfiniteQuery({
    queryKey: [...KEYS.list, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/companies', {
        query: { limit: PAGE_SIZE, ...query, cursor: pageParam },
        schema: companyPageResponseSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.data) ?? [] };
}

/** The three tiles. A failure only hides them: the list works without. */
export function useCompanyStats(query: Query) {
  return useQuery({
    queryKey: [...KEYS.stats, query],
    queryFn: ({ signal }) =>
      apiFetch('/companies/stats', { query, schema: companyStatsResponseSchema, signal }),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 15_000,
  });
}

export function useIndustries() {
  return useQuery({
    queryKey: KEYS.industries,
    queryFn: async ({ signal }) =>
      (await apiFetch('/companies/industries', { schema: companyIndustriesResponseSchema, signal }))
        .data,
    staleTime: 60_000,
    retry: false,
  });
}

export function useCompany(id: string | null) {
  return useQuery({
    queryKey: KEYS.company(id ?? ''),
    queryFn: ({ signal }) => companiesApi.get(id!, signal),
    enabled: id !== null,
    retry: false,
  });
}

/** One company's contacts, "load more" by cursor. */
export function useCompanyContacts(id: string) {
  const q = useInfiniteQuery({
    queryKey: KEYS.contacts(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(`/companies/${id}/contacts`, {
        query: { limit: 50, cursor: pageParam },
        schema: companyContactsPageSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    retry: false,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.data) ?? [] };
}

/** One company's deals, from the deals API (`companyId` filter). Only asked for when the caller may read deals. */
export function useCompanyDeals(id: string, enabled: boolean) {
  const q = useInfiniteQuery({
    queryKey: KEYS.deals(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch('/deals', {
        query: { companyId: id, limit: 50, cursor: pageParam },
        schema: z.object({
          data: z.array(dealResponseSchema),
          page: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }),
        }),
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled,
    retry: false,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.data) ?? [] };
}

export function useCompanyActivity(id: string) {
  const q = useInfiniteQuery({
    queryKey: KEYS.activity(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiFetch(`/companies/${id}/activity`, {
        query: { limit: 20, cursor: pageParam },
        schema: companyActivityPageSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    retry: false,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.data) ?? [] };
}

/**
 * Workspace members for the owner pickers. Listing staff needs a permission not every role has, so when the call is refused
 * the picker still offers the signed-in person.
 */
export function useMembers() {
  const session = useSession();
  return useQuery({
    queryKey: KEYS.members,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }): Promise<Member[]> => {
      try {
        const rows = await companiesApi.members(signal);
        if (rows.length > 0) return rows;
      } catch {
        /* falls through to the signed-in person */
      }
      return [{ id: session.user.id, fullName: session.user.displayName ?? session.user.fullName }];
    },
  });
}

/** Picker rows (Reference's `GET companies/search`): up to 20 by a substring of the name. */
export function useCompanyPicker(q: string, enabled = true) {
  return useQuery({
    queryKey: [...KEYS.picker, q],
    enabled,
    retry: false,
    staleTime: 15_000,
    queryFn: ({ signal }) =>
      apiFetch('/companies/select-data', {
        query: { q: q.trim() || undefined, limit: 20 },
        schema: z.array(companySelectItemSchema),
        signal,
      }),
  });
}

/** After any write: the lists, the tiles and the industry options are stale; so are the open company's pieces. */
export function invalidateCompanies(qc: QueryClient, id?: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: KEYS.list }),
    qc.invalidateQueries({ queryKey: KEYS.stats }),
    qc.invalidateQueries({ queryKey: KEYS.industries }),
    qc.invalidateQueries({ queryKey: KEYS.picker }),
    ...(id
      ? [
          qc.invalidateQueries({ queryKey: KEYS.company(id) }),
          qc.invalidateQueries({ queryKey: KEYS.contacts(id) }),
          qc.invalidateQueries({ queryKey: KEYS.activity(id) }),
        ]
      : []),
  ]);
}

export type { CompanyResponse };
