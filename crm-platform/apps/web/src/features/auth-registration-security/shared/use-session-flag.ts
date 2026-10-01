'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A boolean remembered for the browser session (sessionStorage), shared by every
 * component that reads the same key. Falls back to memory when storage is
 * blocked (private windows, embedded previews), so the UI still behaves.
 */
const memory = new Map<string, boolean>();
const listeners = new Set<() => void>();

function read(key: string): boolean {
  const mem = memory.get(key);
  if (mem !== undefined) return mem;
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useSessionFlag(key: string): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  const set = useCallback(
    (next: boolean) => {
      memory.set(key, next);
      try {
        if (next) sessionStorage.setItem(key, '1');
        else sessionStorage.removeItem(key);
      } catch {
        /* memory copy is enough */
      }
      for (const l of listeners) l();
    },
    [key],
  );
  return [value, set];
}
