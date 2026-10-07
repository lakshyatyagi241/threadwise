'use client';

import { useEffect, useState } from 'react';

/**
 * Cursor paging with Previous and Next: the cursors of the pages visited are kept, so Previous is exact. `reset` (a filter changed)
 * returns to the first page.
 */
export function usePaging(resetKey: string) {
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [seen, setSeen] = useState(resetKey);
  if (seen !== resetKey) {
    // A filter changed: back to the first page, in the same render (no stale page flashes).
    setSeen(resetKey);
    setCursors([undefined]);
  }
  const page = cursors.length;
  return {
    cursor: cursors[cursors.length - 1],
    page,
    hasPrev: page > 1,
    next: (nextCursor: string) => setCursors((c) => [...c, nextCursor]),
    prev: () => setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c)),
  };
}

/** A value that settles after the person stops typing, so a search does not call the API on every key. */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
