import { useEffect, useState } from 'react';

/** `value`, but only once it has stopped changing for `ms` (the live preview calls the API on the settled draft, not on every key). */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

export const PREVIEW_DELAY_MS = 500;
