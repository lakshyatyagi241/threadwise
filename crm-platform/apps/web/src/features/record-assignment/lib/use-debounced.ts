'use client';

import { useEffect, useState } from 'react';

/** `value` after it has stopped changing for `ms` (a search box that should not call the API on every key). */
export function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return out;
}
