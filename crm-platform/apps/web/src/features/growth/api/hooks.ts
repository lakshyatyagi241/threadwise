'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GrowthActionsResponse,
  GrowthActionType,
  GrowthActionDecisionInput,
  UpdateGrowthSettingsInput,
} from '@crm/contracts';
import { growthApi } from './service';

export const KEYS = {
  all: ['growth'] as const,
  settings: ['growth', 'settings'] as const,
  actions: ['growth', 'actions'] as const,
  campaigns: ['growth', 'campaigns'] as const,
  audiences: ['growth', 'audiences'] as const,
  sendTimes: ['growth', 'send-times'] as const,
  propensity: ['growth', 'propensity'] as const,
  quality: ['growth', 'quality'] as const,
  digest: ['growth', 'digest'] as const,
  autoStage: ['growth', 'auto-stage'] as const,
  enrichment: ['growth', 'enrichment'] as const,
  contact: (id: string) => ['growth', 'contact', id] as const,
};

/** A read: off (not even asked) until the part it belongs to is on, and never retried (a refusal is an answer). */
function read<T>(
  key: readonly unknown[],
  enabled: boolean,
  fn: (signal?: AbortSignal) => Promise<T>,
) {
  return {
    queryKey: key,
    enabled,
    retry: false,
    staleTime: 15_000,
    queryFn: ({ signal }: { signal?: AbortSignal }) => fn(signal),
  };
}

export const useGrowthSettings = (enabled: boolean) =>
  useQuery(read(KEYS.settings, enabled, growthApi.settings));
export const useGrowthDigest = (enabled: boolean) =>
  useQuery(read(KEYS.digest, enabled, growthApi.digest));
export const useCampaignReport = (enabled: boolean) =>
  useQuery(read(KEYS.campaigns, enabled, growthApi.campaigns));
export const useAudiences = (enabled: boolean) =>
  useQuery(read(KEYS.audiences, enabled, growthApi.audiences));
export const useSendTimes = (enabled: boolean) =>
  useQuery(read(KEYS.sendTimes, enabled, growthApi.sendTimes));
export const usePropensity = (enabled: boolean) =>
  useQuery(read(KEYS.propensity, enabled, growthApi.propensity));
export const useQuality = (enabled: boolean) =>
  useQuery(read(KEYS.quality, enabled, growthApi.quality));
export const useAutoStage = (enabled: boolean) =>
  useQuery(read(KEYS.autoStage, enabled, growthApi.autoStage));
export const useEnrichment = (enabled: boolean) =>
  useQuery(read(KEYS.enrichment, enabled, growthApi.enrichment));
export const useContactGrowth = (contactId: string, enabled: boolean) =>
  useQuery(read(KEYS.contact(contactId), enabled, (s) => growthApi.contact(contactId, s)));

export const ACTIONS_PAGE_SIZE = 25;

/** The Growth inbox in cursor pages; `type` narrows it to one tab. */
export function useGrowthActions(type: GrowthActionType | undefined, enabled: boolean) {
  const q = useInfiniteQuery({
    queryKey: [...KEYS.actions, type ?? 'all'],
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      growthApi.actions(
        { status: 'open', type, limit: ACTIONS_PAGE_SIZE, cursor: pageParam },
        signal,
      ),
    getNextPageParam: (last: GrowthActionsResponse) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  return {
    ...q,
    items: q.data?.pages.flatMap((p) => p.data) ?? [],
    openByType: q.data?.pages[0]?.openByType,
  };
}

/** Accepting does the work (assigns a chat, records an opt-out), so contacts and the log are stale afterwards. */
export function useDecideActions(onDecided?: () => void | Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GrowthActionDecisionInput) => growthApi.decide(input),
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS.all }),
    onSuccess: async () => {
      await onDecided?.();
    },
  });
}

export function useSaveGrowthSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGrowthSettingsInput) => growthApi.saveSettings(input),
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.settings, saved);
      // A switch changes which of the other reads are allowed at all.
      void qc.invalidateQueries({
        queryKey: KEYS.all,
        predicate: (q) => q.queryKey[1] !== 'settings',
      });
    },
  });
}

/** One button that runs something now and then refreshes everything the Growth screens show. */
function useRun<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: KEYS.all }),
  });
}

export const useStampResponses = () => useRun(() => growthApi.stamp());
export const useSyncAudience = () => useRun((key: string) => growthApi.syncAudience(key));
export const useRecomputePropensity = () => useRun(() => growthApi.recompute());
export const useUndoAutoStage = () => useRun((id: string) => growthApi.undoAutoStage(id));
export const useRunEnrichment = () => useRun(() => growthApi.runEnrichment());

/** Asks the assistant; nothing is changed by it, so nothing is invalidated. */
export const useRecommend = () => useMutation({ mutationFn: growthApi.recommend });
