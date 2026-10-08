'use client';

import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { REALTIME_EVENT, realtimeEventSchemas } from '@crm/contracts';
import { useRealtimeClient, type RealtimeClient } from '@/lib/realtime';
import { GROUP_KEYS } from '../api/groups-hooks';

/** A burst (ten join requests in a second) is one refetch. */
export const GROUPS_LIVE_DEBOUNCE_MS = 300;

/**
 * Keeps the Groups screen current from the realtime socket (BL-099, docs/specs/waba-groups-management.md 14): a `whatsapp.group.changed`
 * hint (a group was created, edited, deleted, got or lost a join request, was suspended or restored, by a colleague or by Meta's
 * webhook) makes the list, the counters, the join-request queue and the invite link of that number fetch again. The hint carries ids and
 * the kind only, so the screen never trusts it for content; the data comes over REST where permission and plan are checked again.
 *
 * The same refetch follows anything that may have made the screen stale (a reconnect, a sequence gap, the tab coming back) on the
 * person's own room. The member list of an open modal is not refetched (it is read from Meta on demand). Returns the unsubscribe.
 */
export function subscribeGroupsLive(
  client: RealtimeClient,
  qc: QueryClient,
  currentNumber: string | null,
): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const refetch = (number: string) => {
    if (timers.has(number)) return;
    timers.set(
      number,
      setTimeout(() => {
        timers.delete(number);
        void qc.invalidateQueries({ queryKey: GROUP_KEYS.list(number) });
      }, GROUPS_LIVE_DEBOUNCE_MS),
    );
  };

  const offEvent = client.subscribe(REALTIME_EVENT.wabaGroupChanged, (event) => {
    const parsed = realtimeEventSchemas[REALTIME_EVENT.wabaGroupChanged].safeParse(event.payload);
    // A payload this build does not understand still means "something changed": fetch the number on screen.
    const number = parsed.success ? parsed.data.connectionId : currentNumber;
    if (number) refetch(number);
  });
  const offResync = client.onResync((request) => {
    if (request.room === 'user' && currentNumber) refetch(currentNumber);
  });
  return () => {
    offEvent();
    offResync();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}

/** Mount it on the Groups screen with the number on show (null: nothing to keep fresh). */
export function useGroupsLive(number: string | null): void {
  const client = useRealtimeClient();
  const qc = useQueryClient();
  useEffect(() => {
    if (!client) return;
    return subscribeGroupsLive(client, qc, number);
  }, [client, qc, number]);
}
