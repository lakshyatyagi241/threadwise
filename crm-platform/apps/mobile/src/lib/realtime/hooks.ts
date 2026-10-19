import {
  realtimeRoomKey,
  type RealtimeEnvelope,
  type RealtimeEventPayload,
  type RealtimeEventType,
  type RealtimeRoomKey,
  type RealtimeRoomSpec,
} from '@crm/contracts';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { RealtimeClient, RealtimeStatus, ResyncRequest, RoomState } from './realtime-client';
import { useRealtimeHolder } from './realtime-provider';

const noopSubscribe = () => () => undefined;

/** The connection, or null before it exists (the first render, and anywhere outside the provider). */
function useRealtimeClient(): RealtimeClient | null {
  const holder = useRealtimeHolder();
  return useSyncExternalStore(holder.subscribe, holder.get, () => null);
}

/** `idle` before the connection exists and anywhere outside the provider. */
export function useRealtimeStatus(): RealtimeStatus {
  const client = useRealtimeClient();
  return useSyncExternalStore(
    useCallback((cb) => (client ? client.onStatus(cb) : noopSubscribe()), [client]),
    () => client?.getStatus() ?? 'idle',
    () => 'idle',
  );
}

/**
 * Holds a room open while the screen is mounted. `spec` null means "no room". The server decides whether the person may join:
 * `denied` is a refusal (no permission, or it does not exist), `joining` includes waiting for a connection. Re-joined by itself after
 * every reconnect.
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
 * Calls `handler` when something this screen shows may be stale: the connection came back, a room was just joined, a sequence number
 * skipped, the app returned to the front, or the server asked. Read the data again; do not try to patch it. `rooms` limits it to those
 * rooms (`user`, `conv:<uuid>`, ...).
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
