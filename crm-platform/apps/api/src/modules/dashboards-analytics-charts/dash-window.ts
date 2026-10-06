import type { AnalyticsQuery, DashRange } from '@crm/contracts';
import { ANALYTICS_MAX_DAYS } from '@crm/contracts';

/**
 * Windows and calendar maths for the dashboard and analytics (TW-DASH-003, 022). Everything is cut in the workspace's
 * time zone (Reference used the application zone), and the previous window has exactly as many days (or hours) as the
 * current one (Reference's start-of-day snap made it slightly longer).
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

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

/** Offset of `tz` from UTC at an instant, in ms (positive east of Greenwich). */
export function zoneOffsetMs(tz: string, at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(at)
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  const local = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

const ymdToUtc = (ymd: string): number => {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const utcToYmd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** `YYYY-MM-DD` of `now` as the zone's wall clock reads it. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return utcToYmd(now.getTime() + zoneOffsetMs(tz, now));
}

export const addDays = (ymd: string, n: number): string => utcToYmd(ymdToUtc(ymd) + n * DAY_MS);
export const daysBetween = (a: string, b: string): number =>
  Math.round((ymdToUtc(b) - ymdToUtc(a)) / DAY_MS);

/** The instant the zone's calendar day `ymd` begins (DST-safe: the offset is looked up at the result). */
export function zonedMidnight(ymd: string, tz: string): Date {
  const guess = ymdToUtc(ymd);
  const first = guess - zoneOffsetMs(tz, new Date(guess));
  const second = guess - zoneOffsetMs(tz, new Date(first));
  return new Date(second);
}

export interface ResolvedWindow {
  from: Date;
  /** Exclusive. */
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  bucket: 'hour' | 'day';
  /** Calendar days covered (day windows); null for 24h. */
  days: number | null;
  /** First local date of the window (day windows). */
  fromDate: string | null;
}

/** A day-based window [fromDate, toDateExclusive) and the equal-length one before it. */
function dayWindow(fromDate: string, toDateExcl: string, tz: string): ResolvedWindow {
  const days = daysBetween(fromDate, toDateExcl);
  return {
    from: zonedMidnight(fromDate, tz),
    to: zonedMidnight(toDateExcl, tz),
    prevFrom: zonedMidnight(addDays(fromDate, -days), tz),
    prevTo: zonedMidnight(fromDate, tz),
    bucket: 'day',
    days,
    fromDate,
  };
}

/** Dashboard ranges (TW-DASH-003): 24h rolling; 7d, 30d from the start of that day to the end of today; quarter to date; custom From/To (`null` past the cap). */
export function resolveDashWindow(
  range: Exclude<DashRange, 'custom'>,
  tz: string,
  now?: Date,
): ResolvedWindow;
export function resolveDashWindow(
  range: DashRange,
  tz: string,
  now?: Date,
  custom?: { from?: string; to?: string },
): ResolvedWindow | null;
export function resolveDashWindow(
  range: DashRange,
  tz: string,
  now: Date = new Date(),
  custom: { from?: string; to?: string } = {},
): ResolvedWindow | null {
  if (range === '24h') {
    const from = new Date(now.getTime() - 24 * HOUR_MS);
    return {
      from,
      to: now,
      prevFrom: new Date(from.getTime() - 24 * HOUR_MS),
      prevTo: from,
      bucket: 'hour',
      days: null,
      fromDate: null,
    };
  }
  const today = todayIn(tz, now);
  const tomorrow = addDays(today, 1);
  if (range === 'custom') {
    // Same rules as analytics (missing From = 30 days ago, swapped if reversed, capped), but never past today:
    // a future To is cut to today before the cap applies.
    const to = custom.to && custom.to > today ? today : custom.to;
    const from = custom.from && custom.from > today ? today : custom.from;
    return resolveAnalyticsWindow({ range: 'custom', from, to }, tz, now);
  }
  if (range === 'qtd') {
    const m = Number(today.slice(5, 7));
    const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
    return dayWindow(
      `${today.slice(0, 4)}-${String(qStartMonth).padStart(2, '0')}-01`,
      tomorrow,
      tz,
    );
  }
  return dayWindow(addDays(today, range === '7d' ? -7 : -30), tomorrow, tz);
}

/**
 * Analytics ranges (TW-DASH-022): 7d, 30d (default), 90d, or custom From/To inclusive. A missing From falls back to 30 days
 * ago, a missing To to today, From after To is swapped. `null` when the span passes the cap (the caller answers 422).
 */
export function resolveAnalyticsWindow(
  q: AnalyticsQuery,
  tz: string,
  now: Date = new Date(),
): (ResolvedWindow & { fromDate: string; toDate: string; days: number }) | null {
  const today = todayIn(tz, now);
  let from: string;
  let to = today;
  if (q.range === 'custom') {
    from = q.from ?? addDays(today, -30);
    to = q.to ?? today;
    if (from > to) [from, to] = [to, from];
  } else {
    from = addDays(today, q.range === '7d' ? -7 : q.range === '90d' ? -90 : -30);
  }
  const w = dayWindow(from, addDays(to, 1), tz);
  if (w.days! > ANALYTICS_MAX_DAYS) return null;
  return { ...w, fromDate: from, toDate: to, days: w.days! };
}

/** The start of the zone's wall-clock hour that holds `at` (zones with a 30 or 45 minute offset start on their own hour). */
export function zonedHourStart(at: Date, tz: string): Date {
  const off = zoneOffsetMs(tz, at);
  return new Date(Math.floor((at.getTime() + off) / HOUR_MS) * HOUR_MS - off);
}
