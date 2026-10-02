'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { wspMemberSchema, wspTeamSchema, type WspRoleTier } from '@crm/contracts';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { wspApi } from './service';

export const KEYS = {
  all: ['workspaces-teams-tenancy'] as const,
  summary: ['workspaces-teams-tenancy', 'summary'] as const,
  members: ['workspaces-teams-tenancy', 'members'] as const,
  teams: ['workspaces-teams-tenancy', 'teams'] as const,
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

/** Members, the summary and every team list move together: a role, a removal or an invite changes all of them. */
export function useRefreshWorkspace() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEYS.all });
}
