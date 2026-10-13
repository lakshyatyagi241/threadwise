import { useEffect, useState } from 'react';

/** The current time, read again every `everyMs`: what a countdown on screen needs to stay right. */
export function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
