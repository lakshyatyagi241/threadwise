'use client';

import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { REALTIME_EVENT, realtimeEventSchemas } from '@crm/contracts';
import { useRealtimeClient, type RealtimeClient } from '@/lib/realtime';
import { GROUP_KEYS } from '../api/groups-hooks';

/** A burst (ten join requests in a second) is one refetch. */
export const GROUPS_LIVE_DEBOUNCE_MS = 300;

/**
 * Keeps the Groups tab current from the realtime socket: a `whatsapp.device_group.changed` hint (a group was created, edited, left,
 * got a join request or new members, by a colleague, by the phone or by another member) makes the list, the counters and the limits
 * of that number fetch again. The hint carries ids and the kind only, so the screen never trusts it for content: the data comes over
 * REST, where permission and the unofficial gate are checked again.
 *
 * A `join_request` also refreshes that group's request queue, and `participants_changed` / `left` its member list (when a window is
 * open). The same refetch follows anything that may have made the screen stale (a reconnect, a sequence gap, the tab coming back) on
 * the person's own room. The invite link is never refetched by a hint: it is read when its panel opens. Returns the unsubscribe.
 */
export function subscribeGroupsLive(
  client: RealtimeClient,
  qc: QueryClient,
  currentDevice: string | null,
): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingGroups = new Map<string, Set<string>>();

  const refetch = (device: string, group?: string, kind?: string) => {
    if (group) {
      const set = pendingGroups.get(device) ?? new Set<string>();
      if (kind === 'join_request') set.add(`r:${group}`);
      if (kind === 'participants_changed' || kind === 'left') set.add(`m:${group}`);
      pendingGroups.set(device, set);
    }
    if (timers.has(device)) return;
    timers.set(
      device,
      setTimeout(() => {
        timers.delete(device);
        void qc.invalidateQueries({ queryKey: GROUP_KEYS.lists(device) });
        void qc.invalidateQueries({ queryKey: GROUP_KEYS.state(device) });
        for (const mark of pendingGroups.get(device) ?? []) {
          const id = mark.slice(2);
          void qc.invalidateQueries({
            queryKey: mark.startsWith('r:') ? GROUP_KEYS.requests(id) : GROUP_KEYS.membersAll(id),
          });
        }
        pendingGroups.delete(device);
      }, GROUPS_LIVE_DEBOUNCE_MS),
    );
  };

  const offEvent = client.subscribe(REALTIME_EVENT.deviceGroupChanged, (event) => {
    const parsed = realtimeEventSchemas[REALTIME_EVENT.deviceGroupChanged].safeParse(event.payload);
    if (parsed.success) refetch(parsed.data.deviceId, parsed.data.groupId, parsed.data.kind);
    // A payload this build does not understand still means "something changed": fetch the number on screen.
    else if (currentDevice) refetch(currentDevice);
  });
  const offResync = client.onResync((request) => {
    if (request.room === 'user' && currentDevice) refetch(currentDevice);
  });
  return () => {
    offEvent();
    offResync();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    pendingGroups.clear();
  };
}

/** Mount it on the Groups tab with the number on show (null: nothing to keep fresh). */
export function useGroupsLive(device: string | null): void {
  const client = useRealtimeClient();
  const qc = useQueryClient();
  useEffect(() => {
    if (!client) return;
    return subscribeGroupsLive(client, qc, device);
  }, [client, qc, device]);
}
