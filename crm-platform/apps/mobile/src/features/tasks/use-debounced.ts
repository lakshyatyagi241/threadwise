import { useEffect, useState } from 'react';

/** How long a search box waits for the person to stop typing before it asks the API. */
export const SEARCH_DEBOUNCE_MS = 300;

/** A value that follows `value` once it has stopped changing for `delayMs`. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
