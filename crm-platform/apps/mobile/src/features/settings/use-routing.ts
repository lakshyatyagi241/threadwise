import type { RoutingRule } from '@crm/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { isApiError } from '@/lib/api';
import {
  deleteRule,
  duplicateRule,
  fetchAssigneeNames,
  fetchRoutingSettings,
  fetchRule,
  fetchRules,
  reorderRules,
  saveRoutingSettings,
  updateRule,
} from './routing-api';

export const routingKey = ['settings', 'routing'] as const;
const settingsKey = [...routingKey, 'settings'] as const;

/** The rules in priority order, a page at a time. No request at all while `enabled` is false (the person may not read the settings). */
export const useRules = (q: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: [...routingKey, 'rules', q.trim()],
    queryFn: ({ pageParam, signal }) => fetchRules(q, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.page.hasMore ? (page.page.nextCursor ?? undefined) : undefined,
    enabled,
  });

export const useRoutingSettings = (enabled: boolean) =>
  useQuery({
    queryKey: settingsKey,
    queryFn: ({ signal }) => fetchRoutingSettings(signal),
    enabled,
  });

/**
 * Names for the ids a rule holds (agents and teams), kept five minutes. A person who may not open the inbox gets none: a rule then
 * says "an agent" for each, as the web does.
 */
export function useTargetNames(enabled: boolean) {
  const query = useQuery({
    queryKey: [...routingKey, 'names'],
    queryFn: ({ signal }) => fetchAssigneeNames(signal),
    staleTime: 5 * 60_000,
    enabled,
  });
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of query.data?.users ?? []) map.set(user.id, user.name ?? user.email);
    for (const team of query.data?.teams ?? []) map.set(team.id, team.name);
    return map;
  }, [query.data]);
  return names;
}

function useRefreshRules() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [...routingKey, 'rules'] });
}

/** Switches a rule on or off. If someone else changed it first, the new version is read and the switch is tried once more, as the web does. */
export function useToggleRule() {
  const refresh = useRefreshRules();
  return useMutation({
    mutationFn: async ({ rule, isActive }: { rule: RoutingRule; isActive: boolean }) => {
      try {
        return await updateRule(rule.id, { rowVersion: rule.rowVersion, isActive });
      } catch (e) {
        if (!(isApiError(e) && e.isRowVersionConflict)) throw e;
        const fresh = await fetchRule(rule.id);
        return await updateRule(rule.id, { rowVersion: fresh.rowVersion, isActive });
      }
    },
    onSettled: refresh,
  });
}

/** Swaps a rule with its neighbour: the two ids in their new order. */
export function useReorderRules() {
  const refresh = useRefreshRules();
  return useMutation({ mutationFn: (ids: string[]) => reorderRules(ids), onSettled: refresh });
}

export function useDuplicateRule() {
  const refresh = useRefreshRules();
  return useMutation({
    mutationFn: (rule: RoutingRule) => duplicateRule(rule.id),
    onSettled: refresh,
  });
}

export function useDeleteRule() {
  const refresh = useRefreshRules();
  return useMutation({
    mutationFn: (rule: RoutingRule) => deleteRule(rule.id),
    onSettled: refresh,
  });
}

export function useSaveRoutingSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keepContactAgent: boolean) => saveRoutingSettings(keepContactAgent),
    onSuccess: (saved) => queryClient.setQueryData(settingsKey, saved),
  });
}
