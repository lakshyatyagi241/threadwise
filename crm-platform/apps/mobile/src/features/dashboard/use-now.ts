import { useEffect, useState } from 'react';

/** The current time, refreshed every `intervalMs`: "5 minutes ago" and the greeting move on while the screen stays open. */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
