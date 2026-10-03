'use client';

import { useEffect, useState } from 'react';

/** The value, but only after it has stopped changing for `ms` (a search box that calls the API once per pause, not per key). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
