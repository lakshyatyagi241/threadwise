'use client';

import { useCallback, useEffect, useState } from 'react';

/** Whole seconds until `deadlineMs`, rounded up, never negative. */
export function secondsLeft(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/**
 * A resend countdown. `start(seconds)` begins it (a 429 hands over
 * `retryAfterSeconds`); `seconds` ticks down to 0. The deadline is wall-clock,
 * so a throttled background tab catches up instead of lagging.
 */
export function useCountdown() {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);

  const start = useCallback((s: number) => {
    setDeadline(Date.now() + s * 1000);
    setSeconds(Math.max(0, Math.ceil(s)));
  }, []);

  useEffect(() => {
    if (deadline === null || seconds <= 0) return;
    const id = setTimeout(() => setSeconds(secondsLeft(deadline, Date.now())), 1000);
    return () => clearTimeout(id);
  }, [deadline, seconds]);

  return { seconds, active: seconds > 0, start };
}
