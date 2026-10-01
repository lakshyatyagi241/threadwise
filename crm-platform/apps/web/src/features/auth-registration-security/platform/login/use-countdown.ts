'use client';

import { useCallback, useEffect, useState } from 'react';

/** Counts whole seconds down to zero from the moment `start` is called. */
export function useCountdown() {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const start = useCallback((seconds: number) => {
    const t = Date.now();
    setNow(t);
    setEndsAt(t + seconds * 1000);
  }, []);
  const stop = useCallback(() => setEndsAt(null), []);

  useEffect(() => {
    if (endsAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [endsAt]);

  const remaining = endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000));
  return { remaining, start, stop };
}
