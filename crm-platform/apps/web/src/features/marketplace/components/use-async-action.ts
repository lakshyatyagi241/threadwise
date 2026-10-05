'use client';

import { useCallback, useRef, useState } from 'react';

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Runs one async call and keeps only its pending flag and its error. The RESULT is handed back to the caller and kept nowhere here:
 * the install and rotate answers hold a one-time secret, and a mutation cache (`useMutation`) would keep it for minutes.
 */
export function useAsyncAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);

  const run = useCallback(async <T>(call: () => Promise<T>): Promise<ActionResult<T>> => {
    const id = ++latest.current;
    setPending(true);
    setError(null);
    try {
      const value = await call();
      if (latest.current === id) setPending(false);
      return { ok: true, value };
    } catch (e) {
      if (latest.current === id) {
        setError(e);
        setPending(false);
      }
      return { ok: false, error: e };
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return { run, pending, error, clearError };
}
