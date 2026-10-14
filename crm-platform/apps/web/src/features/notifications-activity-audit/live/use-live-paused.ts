'use client';

import { useEffect, useState } from 'react';
import { useRealtimeStatus } from '@/lib/realtime';

/** How long the live connection may be missing before the person is told (a page load or a quick reconnect should not flash a note). */
export const LIVE_PAUSED_AFTER_MS = 5_000;

/**
 * True when the live socket has not been connected for a few seconds: no realtime address in this deployment, a refused or dropped
 * connection, or a long reconnect. The bell and the tab title then follow a one-minute poll instead of the server's push, so a title
 * that changes with no toast is explained by this.
 */
export function useLiveUpdatesPaused(afterMs: number = LIVE_PAUSED_AFTER_MS): boolean {
  const connected = useRealtimeStatus() === 'connected';
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (connected) return;
    const timer = setTimeout(() => setLate(true), afterMs);
    return () => {
      clearTimeout(timer);
      // Connected again (or gone): the next gap starts its own grace period.
      setLate(false);
    };
  }, [connected, afterMs]);
  return !connected && late;
}
