import { CRM_DASH_MAX_DAYS, type CrmDashRange } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { addDays, daysBetween, zonedMidnight } from '../../dashboards-analytics-charts';

/**
 * The pure parts of the CRM dashboard: the period (cut in the viewer's zone), the buckets of the trend, and the percentages.
 * No I/O here, so the DST and zone cases are pinned by unit tests.
 */

export interface DashPeriod {
  range: CrmDashRange;
  /** Inclusive local dates. */
  fromDate: string;
  toDate: string;
  days: number;
  /** The instants the period is cut at: [from, toExclusive). */
  from: Date;
  toExclusive: Date;
  prevFromDate: string;
  prevToDate: string;
  prevFrom: Date;
  prevToExclusive: Date;
  today: string;
}

/** `2026-10-17` -> `2026-10-01`. */
const monthStartOf = (ymd: string): string => `${ymd.slice(0, 7)}-01`;

/**
 * `month` is the calendar month to date; `7d`, `30d`, `90d` are that many days ending today (today included); `custom` is the given
 * days inclusive (a missing `to` is today, a missing `from` is 29 days before `to`; a future `to` is cut to today). The previous
 * period has exactly as many calendar days and ends the day before this one starts, so a delta compares like with like even
 * across a month boundary or a daylight-saving change (the bounds are local midnights, not multiples of 24 hours).
 */
export function resolvePeriod(
  range: CrmDashRange,
  tz: string,
  today: string,
  custom: { from?: string; to?: string } = {},
): DashPeriod {
  let fromDate: string;
  let toDate = today;
  if (range === 'month') {
    fromDate = monthStartOf(today);
  } else if (range === 'custom') {
    toDate = custom.to && custom.to < today ? custom.to : today;
    fromDate = custom.from ?? addDays(toDate, -29);
    if (fromDate > toDate) fromDate = toDate;
  } else {
    const n = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    fromDate = addDays(today, -(n - 1));
  }
  const days = daysBetween(fromDate, toDate) + 1;
  if (days > CRM_DASH_MAX_DAYS) {
    throw AppError.validation(`The period can cover at most ${CRM_DASH_MAX_DAYS} days.`, [
      { path: 'from', message: `at most ${CRM_DASH_MAX_DAYS} days` },
    ]);
  }
  const prevToDate = addDays(fromDate, -1);
  const prevFromDate = addDays(fromDate, -days);
  return {
    range,
    fromDate,
    toDate,
    days,
    from: zonedMidnight(fromDate, tz),
    toExclusive: zonedMidnight(addDays(toDate, 1), tz),
    prevFromDate,
    prevToDate,
    prevFrom: zonedMidnight(prevFromDate, tz),
    prevToExclusive: zonedMidnight(fromDate, tz),
    today,
  };
}

export type TrendBucket = 'day' | 'week' | 'month';

/** Up to 31 days: one point per day; up to 140: per week (Monday first); longer: per month. */
export function bucketFor(days: number): TrendBucket {
  return days <= 31 ? 'day' : days <= 140 ? 'week' : 'month';
}

/** The first day of the bucket that holds `ymd`. */
export function bucketStart(ymd: string, bucket: TrendBucket): string {
  if (bucket === 'day') return ymd;
  if (bucket === 'month') return `${ymd.slice(0, 7)}-01`;
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((weekday + 6) % 7));
}

/** Every bucket start from the one holding `fromDate` to the one holding `toDate`, oldest first (empty buckets are kept). */
export function bucketStarts(fromDate: string, toDate: string, bucket: TrendBucket): string[] {
  const out: string[] = [];
  let cur = bucketStart(fromDate, bucket);
  const last = bucketStart(toDate, bucket);
  while (cur <= last) {
    out.push(cur);
    if (bucket === 'day') cur = addDays(cur, 1);
    else if (bucket === 'week') cur = addDays(cur, 7);
    else {
      const [y, m] = cur.split('-').map(Number) as [number, number];
      cur = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    }
  }
  return out;
}

/** Whole percent, half up; 0 when the base is 0. */
export const percent = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

/** won / (won + lost). */
export const winRate = (won: number, lost: number): number => percent(won, won + lost);

/**
 * "Reached" counts of a funnel, one per stage in order, may not rise: a deal that reached stage 3 reached stage 2, even when it was
 * dragged straight there. The query already counts it that way; this is the guard (and the conversion between stages).
 */
export function funnelConversions(reached: number[]): Array<number | null> {
  return reached.map((n, i) => {
    if (i === 0) return null;
    const prev = reached[i - 1] ?? 0;
    return prev > 0 ? Math.min(100, percent(n, prev)) : null;
  });
}
