'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { wabaGroupCountApi, wabaGroupsApi } from './groups-service';

export const GROUP_KEYS = {
  all: (number: string) => ['waba', 'groups', number] as const,
  state: (number: string) => ['waba', 'groups', number, 'state'] as const,
  list: (number: string) => ['waba', 'groups', number, 'list'] as const,
  members: (number: string, group: string) => ['waba', 'groups', number, 'members', group] as const,
};

/** The not-eligible answer is cached for an hour server-side, so the page may reuse it for a minute. */
export function useGroupsState(number: string | null) {
  return useQuery({
    queryKey: GROUP_KEYS.state(number ?? ''),
    queryFn: ({ signal }) => wabaGroupsApi.state(number!, false, signal),
    enabled: number !== null,
    staleTime: 60_000,
    retry: false,
  });
}

/** Newest first, paged by keyset; `pages[0].stats` are the counters of the whole number. */
export function useGroups(number: string | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: GROUP_KEYS.list(number ?? ''),
    queryFn: ({ pageParam, signal }) => wabaGroupsApi.list(number!, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
    enabled: number !== null && enabled,
    retry: false,
  });
}

/** Read from Meta on demand each time the modal opens; never cached (personal data). */
export function useGroupMembers(number: string, group: string, enabled: boolean) {
  return useQuery({
    queryKey: GROUP_KEYS.members(number, group),
    queryFn: ({ signal }) => wabaGroupsApi.members(number, group, signal),
    enabled,
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
}

/** Runs a mutation, then re-reads the number's groups so rows and counters never show stale state. */
function useGroupAction<TVars, TOut>(number: string, fn: (vars: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: GROUP_KEYS.list(number) }),
  });
}

export const useCreateGroup = (number: string) =>
  useGroupAction(number, (v: Parameters<typeof wabaGroupsApi.create>[1]) =>
    wabaGroupsApi.create(number, v),
  );
export const useRefreshGroup = (number: string) =>
  useGroupAction(number, (group: string) => wabaGroupsApi.refresh(number, group));
export const useResetGroupLink = (number: string) =>
  useGroupAction(number, (group: string) => wabaGroupsApi.resetLink(number, group));
export const useUpdateGroup = (number: string) =>
  useGroupAction(
    number,
    (v: { group: string; input: Parameters<typeof wabaGroupsApi.update>[2] }) =>
      wabaGroupsApi.update(number, v.group, v.input),
  );
export const useHandleJoinRequests = (number: string) =>
  useGroupAction(
    number,
    (v: { group: string; input: Parameters<typeof wabaGroupsApi.joinRequests>[2] }) =>
      wabaGroupsApi.joinRequests(number, v.group, v.input),
  );
export const useRemoveParticipants = (number: string) =>
  useGroupAction(
    number,
    (v: { group: string; input: Parameters<typeof wabaGroupsApi.removeParticipants>[2] }) =>
      wabaGroupsApi.removeParticipants(number, v.group, v.input),
  );
export const useDeleteGroup = (number: string) =>
  useGroupAction(number, (group: string) => wabaGroupsApi.remove(number, group));

/** The "Reload" of the not-eligible page: ask Meta again, bypassing the cached answer, and put the answer in the cache. */
export function useRecheckGroupsState(number: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => wabaGroupsApi.state(number, true),
    onSuccess: (data) => {
      qc.setQueryData(GROUP_KEYS.state(number), data);
      return qc.invalidateQueries({ queryKey: GROUP_KEYS.list(number) });
    },
  });
}

/** Read when the remove-number dialog opens, so the warning names how many group records go with the number. */
export function useGroupCountForRemoval(number: string | null) {
  return useQuery({
    queryKey: ['waba', 'group-count', number ?? ''] as const,
    queryFn: ({ signal }) => wabaGroupCountApi(number!, signal),
    enabled: number !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
