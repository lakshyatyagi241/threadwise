'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  wspMemberSchema,
  wspTeamSchema,
  type WspAvailability,
  type WspRoleTier,
} from '@crm/contracts';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { wspApi } from './service';

export const KEYS = {
  all: ['workspaces-teams-tenancy'] as const,
  summary: ['workspaces-teams-tenancy', 'summary'] as const,
  members: ['workspaces-teams-tenancy', 'members'] as const,
  teams: ['workspaces-teams-tenancy', 'teams'] as const,
  availability: ['workspaces-teams-tenancy', 'availability'] as const,
};

/** Header numbers, the roles the caller may grant, the seat line and what the caller may do. */
export function useMembersSummary() {
  return useQuery({
    queryKey: KEYS.summary,
    queryFn: ({ signal }) => wspApi.summary(signal),
    retry: false,
  });
}

/** The table: server-side search and tier filter, "load more" by cursor. */
export function useMembers(q: string, tier: WspRoleTier | undefined) {
  return useCursorList(KEYS.members, '/workspace/members', wspMemberSchema, {
    q: q || undefined,
    tier,
  });
}

/** Everyone in the workspace, for the team dialog's checkboxes: pages are pulled until the list ends. */
export function useAllMembers(enabled: boolean) {
  const list = useCursorList(
    ['workspaces-teams-tenancy', 'members-all'],
    '/workspace/members',
    wspMemberSchema,
    {
      limit: 200,
    },
  );
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    if (enabled && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [enabled, hasNextPage, isFetchingNextPage, fetchNextPage]);
  return list;
}

export function useTeams() {
  return useCursorList(KEYS.teams, '/workspace/teams', wspTeamSchema);
}

/** Every team, pulling pages until the list ends: the tree and the parent picker need the whole picture. */
export function useAllTeams(enabled = true) {
  const list = useCursorList(KEYS.teams, '/workspace/teams', wspTeamSchema, { limit: 200 });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    if (enabled && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [enabled, hasNextPage, isFetchingNextPage, fetchNextPage]);
  return list;
}

/** Members, the summary and every team list move together: a role, a removal or an invite changes all of them. */
export function useRefreshWorkspace() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEYS.all });
}

/** The caller's own Available / Offline switch. A failed read (an operator session, no network) simply hides the control. */
export function useMyAvailability() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEYS.availability,
    queryFn: ({ signal }) => wspApi.myAvailability(signal),
    retry: false,
    staleTime: 60_000,
  });
  const set = useMutation({
    mutationFn: (status: WspAvailability['status']) => wspApi.setMyAvailability({ status }),
    // The switch moves at once; a failed call puts it back.
    onMutate: async (status) => {
      await qc.cancelQueries({ queryKey: KEYS.availability });
      const previous = qc.getQueryData<WspAvailability>(KEYS.availability);
      qc.setQueryData<WspAvailability>(KEYS.availability, { status });
      return { previous };
    },
    onError: (_err, _status, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEYS.availability, ctx.previous);
    },
    onSuccess: (data) => qc.setQueryData(KEYS.availability, data),
  });
  return { query, set };
}
