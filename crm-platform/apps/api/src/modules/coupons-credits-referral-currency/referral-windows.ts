import type { ReferralBucket, ReferralRange, ReferralVolumePoint } from '@crm/contracts';

/**
 * The date maths of the affiliate dashboard (WD-CPN-035), pure so it can be tested without a clock or a database. Everything is
 * UTC: WaDesk used the server's timezone, which put a sign-up on a different day depending on where the server ran.
 */

const DAY_MS = 86_400_000;

/** "All time" is bucketed as five years, as WaDesk did; the rows themselves are read from the day the product existed. */
export const RANGE_DAYS: Readonly<Record<ReferralRange, number>> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: 1825,
};
export const ALL_TIME_START = new Date('2020-01-01T00:00:00.000Z');
/** A daily chart of five years would be 1,825 bars; the most recent year is drawn. */
export const MAX_DAILY_POINTS = 366;

export interface RangeWindow {
  /** Inclusive start of the selected range. */
  start: Date;
  /** Start of the window of equal length right before it (it ends where `start` begins). */
  previousStart: Date;
  days: number;
}

export function rangeWindow(range: ReferralRange, now: Date): RangeWindow {
  const days = RANGE_DAYS[range];
  const start = range === 'all' ? ALL_TIME_START : new Date(now.getTime() - days * DAY_MS);
  return { start, previousStart: new Date(start.getTime() - days * DAY_MS), days };
}

/** Used only when the request names no bucket: a short range reads best by day, a long one by month. */
export function defaultBucket(range: ReferralRange): ReferralBucket {
  const days = RANGE_DAYS[range];
  if (days <= 14) return 'daily';
  if (days <= 90) return 'weekly';
  return 'monthly';
}

/** Whole percent against the previous window; +100 when there was nothing before and there is something now. */
export function deltaPercent(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** The first day of each bucket, oldest first, ending with the bucket that holds `now`. */
export function bucketStarts(bucket: ReferralBucket, range: ReferralRange, now: Date): string[] {
  const days = RANGE_DAYS[range];
  const today = utcDay(now);
  const out: string[] = [];
  if (bucket === 'daily') {
    const n = Math.min(days, MAX_DAILY_POINTS);
    for (let i = n - 1; i >= 0; i--) out.push(ymd(new Date(today.getTime() - i * DAY_MS)));
  } else if (bucket === 'weekly') {
    // Weeks start on Monday (date_trunc('week') in Postgres does the same, so the SQL and this agree).
    const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY_MS);
    const n = Math.ceil(days / 7);
    for (let i = n - 1; i >= 0; i--) out.push(ymd(new Date(monday.getTime() - i * 7 * DAY_MS)));
  } else {
    const n = Math.ceil(days / 30);
    for (let i = n - 1; i >= 0; i--) {
      out.push(ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1))));
    }
  }
  return out;
}

/** One point per bucket: a bucket with no sign-ups is a zero point, so the chart's x axis never skips a day. */
export function fillSeries(
  starts: readonly string[],
  found: ReadonlyArray<{ start: string; signups: number; creditsMinor: number }>,
): ReferralVolumePoint[] {
  const byStart = new Map(found.map((r) => [r.start, r]));
  return starts.map((start) => ({
    start,
    signups: byStart.get(start)?.signups ?? 0,
    creditsMinor: byStart.get(start)?.creditsMinor ?? 0,
  }));
}
