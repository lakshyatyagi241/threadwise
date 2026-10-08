'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  realtimeRoomKey,
  type RealtimeEnvelope,
  type RealtimeEventPayload,
  type RealtimeEventType,
  type RealtimeRoomKey,
  type RealtimeRoomSpec,
} from '@crm/contracts';
import { useRealtimeClient } from './realtime-provider';
import type { RealtimeStatus, ResyncRequest, RoomState } from './realtime-client';
import { startVisibilityReport } from './visibility-report';

const noopSubscribe = () => () => undefined;

/** `idle` on the server, before the connection exists, and where there is no provider. */
export function useRealtimeStatus(): RealtimeStatus {
  const client = useRealtimeClient();
  return useSyncExternalStore(
    useCallback((cb) => (client ? client.onStatus(cb) : noopSubscribe()), [client]),
    () => client?.getStatus() ?? 'idle',
    () => 'idle',
  );
}

/**
 * Holds a room open while the component is mounted. `spec` null means "no room" (a screen with nothing selected). The server
 * decides whether the caller may join: `denied` is a refusal (no permission, or it does not exist), `joining` includes waiting
 * for a connection. Re-joined by itself after every reconnect.
 *
 * Fetch the room's data AFTER it reports `joined` (or when `useResync` says so): an event published between the first fetch and
 * the join would otherwise be missed.
 */
export function useRoom(spec: RealtimeRoomSpec | null): { state: RoomState } {
  const client = useRealtimeClient();
  const key: RealtimeRoomKey | null = spec ? realtimeRoomKey(spec) : null;

  useEffect(() => {
    if (!client || !spec) return;
    return client.join(spec);
    // `key` stands for `spec`: callers build a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  const state = useSyncExternalStore(
    useCallback(
      (cb) => (client && key ? client.onRoomState(key, cb) : noopSubscribe()),
      [client, key],
    ),
    () => (client && key ? client.getRoomState(key) : 'idle'),
    () => 'idle' as RoomState,
  );
  return { state };
}

/** Calls `handler` for every event of `type` the server pushes to a room this client is in. The latest handler is always used. */
export function useRealtimeEvent<T extends RealtimeEventType>(
  type: T,
  handler: (event: RealtimeEnvelope<RealtimeEventPayload<T>>) => void,
): void {
  const client = useRealtimeClient();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    if (!client) return;
    return client.subscribe(type, (event) =>
      latest.current(event as RealtimeEnvelope<RealtimeEventPayload<T>>),
    );
  }, [client, type]);
}

/**
 * Calls `handler` when something this screen shows may be stale: the connection came back, a room was just joined, a sequence
 * number skipped, the tab returned to the foreground, or the server asked. Fetch the data again; do not try to patch it.
 * `rooms` limits it to those rooms (`user`, `conv:<uuid>`, ...).
 */
export function useResync(
  handler: (request: ResyncRequest) => void,
  rooms?: readonly RealtimeRoomKey[],
): void {
  const client = useRealtimeClient();
  const latest = useRef(handler);
  const filter = useRef(rooms);
  useEffect(() => {
    latest.current = handler;
    filter.current = rooms;
  });

  useEffect(() => {
    if (!client) return;
    return client.onResync((request) => {
      if (filter.current && !filter.current.includes(request.room)) return;
      latest.current(request);
    });
  }, [client]);
}

/**
 * Reports to the server whether this tab is in front, for as long as the component is mounted (the closed-tab browser push skips a
 * person who can see the app). Mount it once for the whole session, next to the live notifications.
 */
export function useVisibilityReport(): void {
  const client = useRealtimeClient();
  useEffect(() => {
    if (!client) return;
    return startVisibilityReport(client, document, window);
  }, [client]);
}
