'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LeadEventResponse } from '@crm/contracts';
import { leadKeys, retryEvent } from '../api';

export interface RetryState {
  pending: boolean;
  error: unknown;
  /** The event as it stands after the last retry. */
  result: LeadEventResponse | null;
  run: (eventId: string) => Promise<void>;
  reset: () => void;
}

/**
 * Re-runs a lead that needs review or failed, from its stored payload under the source's current settings. Afterwards the events
 * list, the source (its needs-attention count) and the sources list are reloaded. A refusal (not retryable, payload purged, source
 * paused) is kept in `error` for the caller to show; nothing is retried by itself.
 */
export function useRetry(
  sourceId: string,
  onDone?: (event: LeadEventResponse) => void,
): RetryState {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (eventId: string) => retryEvent(sourceId, eventId).then((r) => r.event),
    onSuccess: (event) => {
      void qc.invalidateQueries({ queryKey: leadKeys.eventsOf(sourceId) });
      void qc.invalidateQueries({ queryKey: leadKeys.one(sourceId) });
      void qc.invalidateQueries({ queryKey: leadKeys.list });
      onDone?.(event);
    },
  });
  return {
    pending: m.isPending,
    error: m.error,
    result: m.data ?? null,
    run: async (eventId) => {
      try {
        await m.mutateAsync(eventId);
      } catch {
        // Shown through `error`.
      }
    },
    reset: m.reset,
  };
}
