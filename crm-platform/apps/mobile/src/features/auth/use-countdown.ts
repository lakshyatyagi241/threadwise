import { useSyncExternalStore } from 'react';
import { secondsLeft } from './countdown';

/**
 * A once-a-second clock. The snapshot is the NEXT whole second, so it is stable between renders within a second and never runs
 * behind the real time: rounded down, a fresh 5:00 countdown would start at 5:01, and a wait of zero would last another second.
 */
function subscribe(onTick: () => void): () => void {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
}
const snapshot = (): number => Math.ceil(Date.now() / 1000) * 1000;

/**
 * Seconds remaining until `endsAt` (epoch ms), ticking once a second; 0 once finished, or when `endsAt` is null. It reads the
 * wall clock on every tick, so a phone that slept catches up as soon as the app is awake again.
 */
export function useCountdown(endsAt: number | null): number {
  const now = useSyncExternalStore(subscribe, snapshot, snapshot);
  return endsAt === null ? 0 : secondsLeft(endsAt, now);
}
