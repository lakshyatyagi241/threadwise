'use client';

import { useSyncExternalStore } from 'react';
import { secondsLeft } from './countdown';

/** A once-a-second clock. The snapshot is the current second, so it is stable between renders within it. */
function subscribe(onTick: () => void): () => void {
  const id = window.setInterval(onTick, 1000);
  return () => window.clearInterval(id);
}
const snapshot = (): number => Math.floor(Date.now() / 1000) * 1000;

/**
 * Seconds remaining until `endsAt` (epoch ms), ticking once a second; 0 once finished, or when `endsAt`
 * is null. Reads the wall clock every tick, so a sleeping tab catches up when it wakes.
 */
export function useCountdown(endsAt: number | null): number {
  const now = useSyncExternalStore(subscribe, snapshot, snapshot);
  return endsAt === null ? 0 : secondsLeft(endsAt, now);
}
