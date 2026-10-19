import type { LeadEventListResponse, LeadEventResponse, LeadSourceResponse } from '@crm/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useActionKeys } from '@/lib/query/use-action-keys';
import {
  getLeadSource,
  listLeadEvents,
  listLeadSources,
  retryLeadEvent,
  setLeadSourceStatus,
} from './api';
import { statusOfFilter, type EventFilter } from './lead-model';

/** Rows asked for at a time; the list asks for the next page when the person scrolls to the end. */
export const PAGE_SIZE = 25;

/** A finished mutation is not looked at again, so the cache forgets it at once instead of holding it for five minutes. */
const NO_KEEP = 0;

export const leadsKey = ['leads'] as const;
export const sourcesKey = [...leadsKey, 'sources'] as const;
export const sourceKey = (id: string) => [...leadsKey, 'source', id] as const;
export const eventsKey = (id: string) => [...leadsKey, 'events', id] as const;
export const eventListKey = (id: string, filter: EventFilter) =>
  [...eventsKey(id), filter] as const;

type EventPages = InfiniteData<LeadEventListResponse, string | undefined>;

/** Every lead source with its "needs attention" count. No request when `enabled` is false (the person may not read lead sources). */
export const useLeadSources = (enabled: boolean) =>
  useQuery({
    queryKey: sourcesKey,
    queryFn: ({ signal }) => listLeadSources(signal),
    enabled,
    select: (answer) => answer.data,
  });

export const useLeadSource = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: sourceKey(id),
    queryFn: ({ signal }) => getLeadSource(id, signal),
    enabled: enabled && id !== '',
  });

/** The leads a source received, a page at a time, newest first. */
export function useLeadEvents(sourceId: string, filter: EventFilter, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: eventListKey(sourceId, filter),
    queryFn: ({ pageParam, signal }) =>
      listLeadEvents(
        sourceId,
        { limit: PAGE_SIZE, cursor: pageParam, status: statusOfFilter(filter) },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled: enabled && sourceId !== '',
  });
}

/** Puts a source the API just returned into the cache: the open source, and the same row in the list. */
function rememberSource(queryClient: QueryClient, source: LeadSourceResponse) {
  queryClient.setQueryData(sourceKey(source.id), source);
  queryClient.setQueryData<{ data: LeadSourceResponse[] }>(sourcesKey, (old) =>
    old ? { ...old, data: old.data.map((row) => (row.id === source.id ? source : row)) } : old,
  );
}

const signature = (source: Pick<LeadSourceResponse, 'id' | 'rowVersion'>, status: string) =>
  `status:${source.id}:${source.rowVersion}:${status}`;

/** Pauses an active source or resumes a paused one, with the version the screen showed (a stale one is 409 ROW_VERSION_CONFLICT). */
export function useSetSourceStatus() {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (source: Pick<LeadSourceResponse, 'id' | 'rowVersion' | 'status'>) => {
      const next = source.status === 'active' ? 'paused' : 'active';
      return setLeadSourceStatus(
        source.id,
        source.rowVersion,
        next,
        keys.keyFor(signature(source, next)),
      );
    },
    onError: (error, source) =>
      keys.failed(signature(source, source.status === 'active' ? 'paused' : 'active'), error),
    onSuccess: (updated, source) => {
      keys.done(signature(source, updated.status));
      rememberSource(queryClient, updated);
    },
  });
}

/** Retries one lead. The event is replaced where it is shown, and the counts on the source are asked again. */
export function useRetryEvent(sourceId: string) {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (event: Pick<LeadEventResponse, 'id'>) =>
      retryLeadEvent(sourceId, event.id, keys.keyFor(`retry:${event.id}`)),
    onError: (error, event) => keys.failed(`retry:${event.id}`, error),
    onSuccess: ({ event }) => {
      keys.done(`retry:${event.id}`);
      queryClient.setQueriesData<EventPages>({ queryKey: eventsKey(sourceId) }, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                data: page.data.map((row) => (row.id === event.id ? event : row)),
              })),
            }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: eventsKey(sourceId) });
      void queryClient.invalidateQueries({ queryKey: sourceKey(sourceId) });
      void queryClient.invalidateQueries({ queryKey: sourcesKey });
    },
  });
}
