/**
 * Calendar maths for the reports, in the workspace's time zone (WD-DEAL-005, 019). WaDesk cut "this month" and its six monthly
 * buckets in the application's zone, whichever workspace asked; here the zone is the workspace's own (`settings.timezone`),
 * UTC when it has none.
 */

/** The zone if it is a real IANA name, else UTC. */
export function resolveTimezone(raw: string | null | undefined): string {
  if (!raw) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    return 'UTC';
  }
}

/** `YYYY-MM-DD` of `now` as the zone's wall clock reads it. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** `2026-10-17` -> `2026-10-01`. */
export const monthStart = (date: string): string => `${date.slice(0, 7)}-01`;

/** `2026-10` shifted by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** The six months ending with the one that holds `anchorDate`, oldest first, plus the bounds to query them in. */
export function monthWindow(anchorDate: string): {
  months: string[];
  firstDay: string;
  endExclusive: string;
} {
  const last = anchorDate.slice(0, 7);
  const months = [-5, -4, -3, -2, -1, 0].map((d) => shiftMonth(last, d));
  return { months, firstDay: `${months[0]}-01`, endExclusive: `${shiftMonth(last, 1)}-01` };
}
