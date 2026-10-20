'use client';

import { useQuery } from '@tanstack/react-query';
import { wspTeamDeletePreviewSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/** What deleting a team changes (BL-380): read when the delete confirmation opens, never cached for long, since the answer moves with every rule edit. */
export function useTeamUsage(teamId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['workspaces-teams-tenancy', 'team-usage', teamId],
    queryFn: ({ signal }) =>
      apiFetch(`/workspace/teams/${teamId}/usage`, { schema: wspTeamDeletePreviewSchema, signal }),
    enabled: enabled && teamId !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}
