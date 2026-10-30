/** Small time helpers for the one-time-code step (TW-AUTH-006). Pure, so they can be unit tested. */

/** Whole seconds left until `endsAtMs`, never negative (rounded up so "0:01" shows until the very end). */
export function secondsLeft(endsAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000));
}

/** "4:07" for 247 seconds. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
