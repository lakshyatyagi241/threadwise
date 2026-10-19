'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import type { TaskResponse } from '@crm/contracts';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { configureMock, mockEnabled } from './http';
import { taskOutcomesApi, tasksApi, type TaskPageResult, type TaskSource } from './service';
import type { Member, RecordRef } from './schemas';
import { transientRetry, transientRetryDelay } from '@/lib/api/retry';

export const KEYS = {
  all: ['tasks'] as const,
  list: ['tasks', 'list'] as const,
  counts: ['tasks', 'counts'] as const,
  task: (id: string) => ['tasks', 'task', id] as const,
  members: ['tasks', 'members'] as const,
  outcomes: ['tasks', 'outcomes'] as const,
  ref: (kind: 'contact' | 'deal' | 'company', id: string) => ['tasks', 'ref', kind, id] as const,
};

/** Keeps the development stand-in (when it is on) in step with who is signed in. Call it once near the top of a screen. */
export function useTasksSetup(): void {
  const session = useSession();
  if (mockEnabled()) {
    configureMock({ id: session.user.id, name: session.user.displayName ?? session.user.fullName });
  }
}

const PAGE_SIZE = 25;

/** The list: every task of the source that passes the query, "load more" by cursor. */
export function useTasksList(
  source: TaskSource,
  query: Record<string, string | number | boolean | undefined>,
  opts: { enabled?: boolean; limit?: number } = {},
) {
  const q = useInfiniteQuery({
    queryKey: [...KEYS.list, source, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      tasksApi.list(
        source,
        { limit: opts.limit ?? PAGE_SIZE, ...query, cursor: pageParam },
        signal,
      ),
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.tasks) ?? [] };
}

/** Tab badges. A failure only hides the badges: the lists work without them. */
export function useTaskCounts(query: Record<string, string | boolean | undefined>) {
  return useQuery({
    queryKey: [...KEYS.counts, query],
    queryFn: ({ signal }) => tasksApi.counts(query, signal),
    placeholderData: keepPreviousData,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
    staleTime: 15_000,
  });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: KEYS.task(id ?? ''),
    queryFn: ({ signal }) => tasksApi.get(id!, signal),
    enabled: id !== null,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

/**
 * The task outcomes. `activeOnly` is what a picker offers; the settings screen lists all. A failure (no permission, an older server)
 * leaves the pickers empty rather than breaking the task form: they are optional.
 */
export function useTaskOutcomes(activeOnly: boolean, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...KEYS.outcomes, activeOnly],
    queryFn: ({ signal }) => taskOutcomesApi.list(activeOnly, signal),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

/** After the list changed: every picker and the settings screen refetch, and so do the task lists (names and counts move). */
export function invalidateTaskOutcomes(qc: QueryClient) {
  return Promise.all([qc.invalidateQueries({ queryKey: KEYS.outcomes }), invalidateTasks(qc)]);
}

/**
 * Workspace members for the assignee pickers. Listing staff needs a permission not every role has, so when the call is
 * refused the picker still offers the signed-in person.
 */
export function useMembers() {
  const session = useSession();
  return useQuery({
    queryKey: KEYS.members,
    staleTime: 5 * 60_000,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
    queryFn: async ({ signal }): Promise<Member[]> => {
      try {
        const rows = await tasksApi.members(signal);
        if (rows.length > 0) return rows;
      } catch {
        /* falls through to the signed-in person */
      }
      return [{ id: session.user.id, fullName: session.user.displayName ?? session.user.fullName }];
    },
  });
}

/** A contact, deal or company known only by id (it arrived in the address): its name for the filter chip. */
export function useRecordRef(kind: 'contact' | 'deal' | 'company', id: string) {
  return useQuery({
    queryKey: KEYS.ref(kind, id),
    enabled: id !== '',
    retry: transientRetry,
    retryDelay: transientRetryDelay,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }): Promise<RecordRef> => {
      if (kind === 'contact') {
        const c = await tasksApi.contactById(id, signal);
        return {
          id: c.id,
          label: c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phone || '',
          hint: c.phone,
        };
      }
      if (kind === 'company') {
        const co = await tasksApi.companyById(id, signal);
        return { id: co.id, label: co.name, hint: co.industry };
      }
      const d = await tasksApi.dealById(id, signal);
      return { id: d.id, label: d.title };
    },
  });
}

type ListData = InfiniteData<TaskPageResult, string | undefined>;

/** Replaces one task inside every cached list page (and its own entry), so a change shows before the refetch lands. */
export function patchTaskInCache(qc: QueryClient, task: TaskResponse): void {
  qc.setQueriesData<ListData>({ queryKey: KEYS.list }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            tasks: p.tasks.map((t) => (t.id === task.id ? task : t)),
          })),
        }
      : data,
  );
  qc.setQueryData(KEYS.task(task.id), task);
}

/** Takes a task out of every cached list page (deleted). */
export function removeTaskFromCache(qc: QueryClient, ids: ReadonlySet<string>): void {
  qc.setQueriesData<ListData>({ queryKey: KEYS.list }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({ ...p, tasks: p.tasks.filter((t) => !ids.has(t.id)) })),
        }
      : data,
  );
}

/** After any write: the lists and the badges are stale; the open task's own entry too. */
export function invalidateTasks(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: KEYS.list }),
    qc.invalidateQueries({ queryKey: KEYS.counts }),
  ]);
}
