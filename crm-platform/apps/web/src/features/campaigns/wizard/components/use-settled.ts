'use client';

import { useEffect, useState } from 'react';

/**
 * `value` once it has stopped changing for `ms` (compared by content, so a new object with the same content does not restart
 * the timer). `settled` is false while a newer value is waiting. Values must survive JSON (the wizard's audience and variables do).
 */
export function useSettled<T>(value: T, ms: number): { value: T; settled: boolean } {
  const key = JSON.stringify(value) ?? 'null';
  const [current, setCurrent] = useState({ key, value });
  useEffect(() => {
    if (key === current.key) return;
    const id = setTimeout(() => setCurrent({ key, value: JSON.parse(key) as T }), ms);
    return () => clearTimeout(id);
  }, [key, ms, current.key]);
  return { value: current.value, settled: current.key === key };
}
