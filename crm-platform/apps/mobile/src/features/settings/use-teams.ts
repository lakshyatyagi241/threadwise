import type { WspTeam } from '@crm/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMembers } from './members-api';
import { createTeam, deleteTeam, fetchTeams, updateTeam } from './teams-api';
import { membersKey } from './use-members';

/** Under the members key on purpose: a member's team places and a team's members change together, so one refresh moves both. */
export const teamsKey = [...membersKey, 'teams'] as const;

const ALL_MEMBERS_PAGE = 200;

/** The teams a page at a time. */
export const useTeamList = (enabled = true) =>
  useInfiniteQuery({
    queryKey: teamsKey,
    queryFn: ({ pageParam, signal }) => fetchTeams(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.page.hasMore ? (page.page.nextCursor ?? undefined) : undefined,
    enabled,
  });

/** Everyone in the workspace, for the member checkboxes: the caller pulls pages until `hasNextPage` is false. */
export const useAllMembers = (enabled: boolean) =>
  useInfiniteQuery({
    queryKey: [...membersKey, 'all'],
    queryFn: ({ pageParam, signal }) =>
      fetchMembers({ q: '', tier: undefined }, pageParam, signal, ALL_MEMBERS_PAGE),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) =>
      page.page.hasMore ? (page.page.nextCursor ?? undefined) : undefined,
    enabled,
  });

function useRefreshWorkspace() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: membersKey });
}

export function useCreateTeam() {
  const refresh = useRefreshWorkspace();
  return useMutation({
    mutationFn: (input: Parameters<typeof createTeam>[0]) => createTeam(input),
    onSuccess: refresh,
  });
}

export function useUpdateTeam(id: string) {
  const refresh = useRefreshWorkspace();
  return useMutation({
    mutationFn: (input: Parameters<typeof updateTeam>[1]) => updateTeam(id, input),
    // A conflict leaves the form holding an old version: read again either way.
    onSettled: refresh,
  });
}

export function useDeleteTeam() {
  const refresh = useRefreshWorkspace();
  return useMutation({ mutationFn: (team: WspTeam) => deleteTeam(team.id), onSettled: refresh });
}
