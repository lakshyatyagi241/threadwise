'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import type { SalesDocKind } from '../lib/kinds';
import type { DocCounts, Member, SalesDoc } from './schemas';
import { salesDocsApi, type DocPageResult } from './service';

export const KEYS = {
  all: ['sales-docs'] as const,
  list: ['sales-docs', 'list'] as const,
  counts: ['sales-docs', 'counts'] as const,
  doc: (id: string) => ['sales-docs', 'doc', id] as const,
  events: (id: string) => ['sales-docs', 'events', id] as const,
  linked: (link: string) => ['sales-docs', 'linked', link] as const,
  members: ['sales-docs', 'members'] as const,
};

const PAGE_SIZE = 25;

type Query = Record<string, string | number | boolean | undefined>;

/** The list: every document of the kind that passes the query, "load more" by cursor. */
export function useDocsList(
  kind: SalesDocKind,
  query: Query,
  opts: { enabled?: boolean; limit?: number } = {},
) {
  const q = useInfiniteQuery({
    queryKey: [...KEYS.list, kind, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      salesDocsApi.list(
        kind,
        { limit: opts.limit ?? PAGE_SIZE, ...query, cursor: pageParam },
        signal,
      ),
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.docs) ?? [] };
}

/** Tab badges and the open-value figure. A failure only hides them: the list works without. */
export function useDocCounts(kind: SalesDocKind, query: Query) {
  return useQuery({
    queryKey: [...KEYS.counts, kind, query],
    queryFn: ({ signal }): Promise<DocCounts> => salesDocsApi.counts(kind, query, signal),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 15_000,
  });
}

export function useDoc(id: string | null) {
  return useQuery({
    queryKey: KEYS.doc(id ?? ''),
    queryFn: ({ signal }) => salesDocsApi.get(id!, signal),
    enabled: id !== null,
    retry: false,
  });
}

export function useDocEvents(id: string | null) {
  return useQuery({
    queryKey: KEYS.events(id ?? ''),
    queryFn: ({ signal }) => salesDocsApi.events(id!, signal),
    enabled: id !== null,
    retry: false,
  });
}

/** The documents of one contact or deal (both kinds), for the panel on their pages. */
export function useLinkedDocs(link: { kind: 'contact' | 'deal'; id: string }, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.linked(`${link.kind}:${link.id}`),
    queryFn: ({ signal }) =>
      salesDocsApi.linked(
        link.kind === 'contact' ? { contactId: link.id } : { dealId: link.id },
        signal,
      ),
    enabled,
    retry: false,
  });
}

/**
 * Workspace members for the owner filter. Listing staff needs a permission not every role has, so when the call is refused the
 * filter still offers the signed-in person.
 */
export function useMembers() {
  const session = useSession();
  return useQuery({
    queryKey: KEYS.members,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }): Promise<Member[]> => {
      try {
        const rows = await salesDocsApi.members(signal);
        if (rows.length > 0) return rows;
      } catch {
        /* falls through to the signed-in person */
      }
      return [{ id: session.user.id, fullName: session.user.displayName ?? session.user.fullName }];
    },
  });
}

type ListData = InfiniteData<DocPageResult, string | undefined>;

/** Replaces one document inside every cached list page (and its own entry), so a change shows before the refetch lands. */
export function patchDocInCache(qc: QueryClient, doc: SalesDoc): void {
  qc.setQueriesData<ListData>({ queryKey: KEYS.list }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            docs: p.docs.map((d) => (d.id === doc.id ? doc : d)),
          })),
        }
      : data,
  );
  qc.setQueryData(KEYS.doc(doc.id), doc);
}

/** Takes documents out of every cached list page (deleted). */
export function removeDocsFromCache(qc: QueryClient, ids: ReadonlySet<string>): void {
  qc.setQueriesData<ListData>({ queryKey: KEYS.list }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({ ...p, docs: p.docs.filter((d) => !ids.has(d.id)) })),
        }
      : data,
  );
}

/** After any write: the lists, the badges, the panels and the activity are stale. */
export function invalidateDocs(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: KEYS.list }),
    qc.invalidateQueries({ queryKey: KEYS.counts }),
    qc.invalidateQueries({ queryKey: ['sales-docs', 'linked'] }),
    qc.invalidateQueries({ queryKey: ['sales-docs', 'events'] }),
  ]);
}
