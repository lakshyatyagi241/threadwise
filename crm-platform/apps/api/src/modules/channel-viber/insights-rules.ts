/** Pure helpers of the insights screen (TW-VIB-016): the viewer's time zone and the seven days. */

/** The zone as given when it is a real IANA zone, else UTC. */
export function validTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** `YYYY-MM-DD` of an instant in a time zone. */
export function dayIn(tz: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * The last `n` days ending today in the zone, oldest first. Today is read in the zone, then stepped back as plain calendar dates, so
 * a daylight saving change can neither skip nor repeat a day.
 */
export function lastDays(tz: string, now: Date, n: number): string[] {
  const today = Date.parse(`${dayIn(tz, now)}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) =>
    new Date(today - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

/** Whole percent of `n` out of `d`; 0 with nothing to divide by (the screen shows "12% seen · 40% delivered"). */
export const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 100) : 0);
