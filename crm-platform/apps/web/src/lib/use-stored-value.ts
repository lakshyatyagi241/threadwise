'use client';

import { useCallback, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

/**
 * A per-browser preference kept in localStorage as a string (null when never set). The server and the first client
 * render see `null`, so hydration matches; blocked storage (private mode) just means nothing is remembered.
 */
export function useStoredValue(key: string): [string | null, (next: string | null) => void] {
  const read = () => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const value = useSyncExternalStore(subscribe, read, () => null);
  const set = useCallback(
    (next: string | null) => {
      try {
        if (next === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, next);
      } catch {
        /* not remembered */
      }
      for (const l of listeners) l();
    },
    [key],
  );
  return [value, set];
}
