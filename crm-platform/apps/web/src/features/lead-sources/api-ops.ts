'use client';

import { useQuery } from '@tanstack/react-query';
import { speedToLeadOptionsResponseSchema, type SpeedToLeadChannel } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/**
 * The calls of the lead pipeline's operations screens (speed-to-lead's pickers, the lead inbox), kept apart from the source screens'
 * own `api.ts`. Same rules: through the same-origin proxy, every answer parsed with its contract schema at the boundary.
 */

const ROOT = '/lead-sources';

export const opsKeys = {
  speedOptions: (channel: SpeedToLeadChannel) =>
    ['lead-sources', 'speed-options', channel] as const,
};

/** The templates and senders the first-message setting can choose from on a channel. */
export const fetchSpeedOptions = (channel: SpeedToLeadChannel, signal?: AbortSignal) =>
  apiFetch(`${ROOT}/speed-to-lead/options`, {
    query: { channel },
    schema: speedToLeadOptionsResponseSchema,
    signal,
  });

export const useSpeedOptions = (channel: SpeedToLeadChannel, enabled: boolean) =>
  useQuery({
    queryKey: opsKeys.speedOptions(channel),
    queryFn: ({ signal }) => fetchSpeedOptions(channel, signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
