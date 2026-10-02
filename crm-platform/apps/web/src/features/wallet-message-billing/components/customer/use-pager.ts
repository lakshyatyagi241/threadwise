'use client';

import { useCallback, useState } from 'react';

/** Previous/Next over a cursor API: the cursors already visited are kept so "Previous" can go back. */
export function usePager() {
  const [stack, setStack] = useState<Array<string | undefined>>([undefined]);
  const cursor = stack[stack.length - 1];
  const next = useCallback((nextCursor: string) => setStack((s) => [...s, nextCursor]), []);
  const prev = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback(() => setStack([undefined]), []);
  return { cursor, page: stack.length, hasPrev: stack.length > 1, next, prev, reset };
}
