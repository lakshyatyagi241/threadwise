import type {
  CreateDealActivityInput,
  CreateDealInput,
  DealResponse,
  MarkDealLostInput,
  MoveDealStageInput,
  UpdateDealInput,
} from '@crm/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useActionKeys } from '@/lib/query/use-action-keys';
import {
  addActivity,
  createDeal,
  deleteDeal,
  getBoard,
  getDeal,
  getDealSettings,
  listActivities,
  listAssignees,
  listDeals,
  listLostReasons,
  listPipelines,
  listStageDeals,
  markDealLost,
  markDealWon,
  moveDealStage,
  reopenDeal,
  searchContacts,
  setActivityDone,
  updateDeal,
  type DealFilters,
  type DealListFilters,
} from './api';

/** Cards asked for at a time in one column, and rows in the flat list; the next page is asked for at the end of the list. */
export const COLUMN_PAGE_SIZE = 25;
export const LIST_PAGE_SIZE = 50;
export const TIMELINE_PAGE_SIZE = 30;

/** A finished mutation is not looked at again, so the cache forgets it at once instead of holding it for five minutes. */
const NO_KEEP = 0;

export const dealsKey = ['deals'] as const;
export const boardsKey = [...dealsKey, 'board'] as const;
export const boardKey = (pipelineId: string, filters: DealFilters) =>
  [...boardsKey, pipelineId, filters] as const;
export const stagesKey = [...dealsKey, 'stage'] as const;
export const stageKey = (stageId: string, filters: DealFilters) =>
  [...stagesKey, stageId, filters] as const;
export const listsKey = [...dealsKey, 'list'] as const;
export const listKey = (pipelineId: string, filters: DealListFilters) =>
  [...listsKey, pipelineId, filters] as const;
export const dealKey = (id: string) => [...dealsKey, 'detail', id] as const;
export const activitiesKey = (id: string) => [...dealsKey, 'activities', id] as const;
export const pipelinesKey = [...dealsKey, 'pipelines'] as const;
export const lostReasonsKey = [...dealsKey, 'lost-reasons'] as const;
export const settingsKey = [...dealsKey, 'settings'] as const;
export const assigneesKey = [...dealsKey, 'assignees'] as const;
export const contactChoicesKey = (q: string) => [...dealsKey, 'contact-choices', q] as const;

/**
 * Keeps the rows on screen while a narrower answer loads (typing in the search box), but only for the SAME pipeline or column: a
 * different one starts from its own loading state, so a tab that was just pressed never shows another stage's deals under it.
 * `scope` is the position in the query key that names the pipeline or the stage.
 */
const keepWithin =
  (scope: number) =>
  <T>(
    previous: T | undefined,
    previousQuery: { queryKey: readonly unknown[] } | undefined,
    key: string,
  ) =>
    previousQuery?.queryKey[scope] === key ? previous : undefined;

/** The pipeline the API picks when none is asked for (the workspace default). */
const DEFAULT_PIPELINE = 'default';

// --- reads -------------------------------------------------------------------------------------------------------------------

/** Every pipeline with its stages. `enabled` is false for a person who may not read pipelines (the board still opens the default one). */
export const usePipelines = (enabled: boolean) =>
  useQuery({
    queryKey: pipelinesKey,
    queryFn: ({ signal }) => listPipelines(signal),
    enabled,
  });

/**
 * One pipeline's board: its columns with counts and totals, and the KPIs. Cards are not taken from here (one per column is
 * asked for); the open column pages through `useColumnDeals`.
 */
export function useBoard(pipelineId: string | undefined, filters: DealFilters, enabled: boolean) {
  return useQuery({
    queryKey: boardKey(pipelineId ?? DEFAULT_PIPELINE, filters),
    queryFn: ({ signal }) => getBoard({ ...filters, pipelineId, limit: 1 }, signal),
    enabled,
    // Typing in the search box keeps the columns on screen until the narrowed ones arrive.
    placeholderData: (previous, previousQuery) =>
      keepWithin(2)(previous, previousQuery, pipelineId ?? DEFAULT_PIPELINE),
  });
}

/** One column's cards in the column's order, a page at a time. */
export function useColumnDeals(
  stageId: string | undefined,
  filters: DealFilters,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: stageKey(stageId ?? '', filters),
    queryFn: ({ pageParam, signal }) =>
      listStageDeals(
        stageId ?? '',
        { ...filters, limit: COLUMN_PAGE_SIZE, cursor: pageParam },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled: enabled && stageId !== undefined,
    placeholderData: (previous, previousQuery) =>
      keepWithin(2)(previous, previousQuery, stageId ?? ''),
  });
}

/** The flat list of the pipeline's deals, newest first, a page at a time. */
export function useDealList(
  pipelineId: string | undefined,
  filters: DealListFilters,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: listKey(pipelineId ?? DEFAULT_PIPELINE, filters),
    queryFn: ({ pageParam, signal }) =>
      listDeals({ ...filters, pipelineId, limit: LIST_PAGE_SIZE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled,
    placeholderData: (previous, previousQuery) =>
      keepWithin(2)(previous, previousQuery, pipelineId ?? DEFAULT_PIPELINE),
  });
}

export const useDeal = (id: string, enabled = true) =>
  useQuery({
    queryKey: dealKey(id),
    queryFn: ({ signal }) => getDeal(id, signal),
    enabled: enabled && id !== '',
  });

/** The reasons a deal can be lost for. `enabled` is false for a person who may not read pipelines: the sheet then offers free text. */
export const useLostReasons = (enabled: boolean) =>
  useQuery({
    queryKey: lostReasonsKey,
    queryFn: ({ signal }) => listLostReasons(signal),
    enabled,
  });

/** Whether a reason is required for a lost deal. */
export const useDealSettings = (enabled: boolean) =>
  useQuery({
    queryKey: settingsKey,
    queryFn: ({ signal }) => getDealSettings(signal),
    enabled,
  });

/** The deal's timeline, newest first, a page at a time. */
export function useActivities(dealId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: activitiesKey(dealId),
    queryFn: ({ pageParam, signal }) =>
      listActivities(dealId, { limit: TIMELINE_PAGE_SIZE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    enabled: enabled && dealId !== '',
  });
}

/** The team a deal can be given to. `enabled` is false for a person who may not read contacts (the API keeps the list there). */
export const useAssignees = (enabled: boolean) =>
  useQuery({
    queryKey: assigneesKey,
    queryFn: ({ signal }) => listAssignees(signal),
    enabled,
  });

/** Contacts matching the words typed in the picker; the rows stay while the next answer loads. */
export const useContactChoices = (q: string, enabled: boolean) =>
  useQuery({
    queryKey: contactChoicesKey(q),
    queryFn: ({ signal }) => searchContacts(q, signal),
    enabled,
    placeholderData: (previous) => previous,
  });

// --- writes ------------------------------------------------------------------------------------------------------------------

/**
 * Puts a deal the API just returned into the cache: the open deal, and every board, column and list refetches (a move changes
 * two columns and the KPIs, so patching the lists in place would only be a guess). The contact screen's own deals list is the
 * contacts feature's cache, named here by its key prefix since one feature may not import another.
 */
function remember(queryClient: QueryClient, deal: DealResponse) {
  queryClient.setQueryData(dealKey(deal.id), deal);
  void queryClient.invalidateQueries({ queryKey: boardsKey });
  void queryClient.invalidateQueries({ queryKey: stagesKey });
  void queryClient.invalidateQueries({ queryKey: listsKey });
  void queryClient.invalidateQueries({ queryKey: activitiesKey(deal.id) });
  void queryClient.invalidateQueries({ queryKey: ['contacts', 'deals'] });
}

/** What an action needs to know about the deal it was made on. */
export type DealRef = Pick<DealResponse, 'id' | 'rowVersion'>;

/** A write is the same request only while its body is: a corrected form after a lost connection is a new one. */
const bodySignature = (action: string, body: unknown) => `${action}:${JSON.stringify(body)}`;

export function useMoveDeal() {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: ({ deal, body }: { deal: DealRef; body: MoveDealStageInput }) =>
      moveDealStage(
        deal.id,
        { ...body, rowVersion: deal.rowVersion },
        keys.keyFor(bodySignature(`move:${deal.id}:${deal.rowVersion}`, body)),
      ),
    onError: (error, { deal, body }) =>
      keys.failed(bodySignature(`move:${deal.id}:${deal.rowVersion}`, body), error),
    onSuccess: (deal, { deal: sent, body }) => {
      keys.done(bodySignature(`move:${sent.id}:${sent.rowVersion}`, body));
      remember(queryClient, deal);
    },
  });
}

export function useMarkWon() {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (deal: DealRef) =>
      markDealWon(deal.id, deal.rowVersion, keys.keyFor(`won:${deal.id}:${deal.rowVersion}`)),
    onError: (error, deal) => keys.failed(`won:${deal.id}:${deal.rowVersion}`, error),
    onSuccess: (deal, sent) => {
      keys.done(`won:${sent.id}:${sent.rowVersion}`);
      remember(queryClient, deal);
    },
  });
}

export function useMarkLost() {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: ({ deal, body }: { deal: DealRef; body: Omit<MarkDealLostInput, 'rowVersion'> }) =>
      markDealLost(
        deal.id,
        { ...body, rowVersion: deal.rowVersion },
        keys.keyFor(bodySignature(`lost:${deal.id}:${deal.rowVersion}`, body)),
      ),
    onError: (error, { deal, body }) =>
      keys.failed(bodySignature(`lost:${deal.id}:${deal.rowVersion}`, body), error),
    onSuccess: (deal, { deal: sent, body }) => {
      keys.done(bodySignature(`lost:${sent.id}:${sent.rowVersion}`, body));
      remember(queryClient, deal);
    },
  });
}

export function useReopenDeal() {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (deal: DealRef) =>
      reopenDeal(
        deal.id,
        { rowVersion: deal.rowVersion },
        keys.keyFor(`reopen:${deal.id}:${deal.rowVersion}`),
      ),
    onError: (error, deal) => keys.failed(`reopen:${deal.id}:${deal.rowVersion}`, error),
    onSuccess: (deal, sent) => {
      keys.done(`reopen:${sent.id}:${sent.rowVersion}`);
      remember(queryClient, deal);
    },
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (id: string) => deleteDeal(id, keys.keyFor(`delete:${id}`)),
    onError: (error, id) => keys.failed(`delete:${id}`, error),
    onSuccess: (_, id) => {
      keys.done(`delete:${id}`);
      queryClient.removeQueries({ queryKey: dealKey(id) });
      queryClient.removeQueries({ queryKey: activitiesKey(id) });
      void queryClient.invalidateQueries({ queryKey: boardsKey });
      void queryClient.invalidateQueries({ queryKey: stagesKey });
      void queryClient.invalidateQueries({ queryKey: listsKey });
      void queryClient.invalidateQueries({ queryKey: ['contacts', 'deals'] });
    },
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (body: CreateDealInput) =>
      createDeal(body, keys.keyFor(bodySignature('create', body))),
    onError: (error, body) => keys.failed(bodySignature('create', body), error),
    onSuccess: (deal, body) => {
      keys.done(bodySignature('create', body));
      remember(queryClient, deal);
    },
  });
}

export function useUpdateDeal(id: string) {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (body: UpdateDealInput) =>
      updateDeal(id, body, keys.keyFor(bodySignature(`update:${id}`, body))),
    onError: (error, body) => keys.failed(bodySignature(`update:${id}`, body), error),
    onSuccess: (deal, body) => {
      keys.done(bodySignature(`update:${id}`, body));
      remember(queryClient, deal);
    },
  });
}

/**
 * A timeline entry added to the deal. A task added here is mirrored into the Tasks list by the server, so that list's cache
 * (the tasks feature's, named here by its key prefix) is refreshed too.
 */
export function useAddActivity(dealId: string) {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: (body: CreateDealActivityInput) =>
      addActivity(dealId, body, keys.keyFor(bodySignature(`activity:${dealId}`, body))),
    onError: (error, body) => keys.failed(bodySignature(`activity:${dealId}`, body), error),
    onSuccess: (_, body) => {
      keys.done(bodySignature(`activity:${dealId}`, body));
      void queryClient.invalidateQueries({ queryKey: activitiesKey(dealId) });
      if (body.type === 'task') void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/** Marks a timeline task done or opens it again; either is harmless to repeat. */
export function useToggleActivity(dealId: string) {
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  return useMutation({
    gcTime: NO_KEEP,
    mutationFn: ({ activityId, done }: { activityId: string; done: boolean }) =>
      setActivityDone(dealId, activityId, done, keys.keyFor(`toggle:${activityId}:${done}`)),
    onError: (error, { activityId, done }) => keys.failed(`toggle:${activityId}:${done}`, error),
    onSuccess: (_, { activityId, done }) => {
      keys.done(`toggle:${activityId}:${done}`);
      void queryClient.invalidateQueries({ queryKey: activitiesKey(dealId) });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
