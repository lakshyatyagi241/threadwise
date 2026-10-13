'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  channelListResponseSchema,
  teamAnalyticsResponseSchema,
  type TeamAnalyticsRange,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const ANALYTICS_REFRESH_MS = 30_000;

/** The Team Performance report; repaints every 30 seconds while the page is open, as Reference did. */
export function useTeamAnalytics(
  range: TeamAnalyticsRange,
  channelId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['team-analytics', range, channelId ?? null],
    enabled,
    retry: false,
    placeholderData: keepPreviousData,
    refetchInterval: ANALYTICS_REFRESH_MS,
    queryFn: ({ signal }) =>
      apiFetch('/inbox/analytics/team', {
        query: { range, channelId },
        schema: teamAnalyticsResponseSchema,
        signal,
      }),
  });
}

/** The channels the device filter offers. */
export function useAnalyticsChannels(enabled: boolean) {
  return useQuery({
    queryKey: ['team-analytics', 'channels'],
    enabled,
    queryFn: ({ signal }) => apiFetch('/channels', { schema: channelListResponseSchema, signal }),
  });
}
