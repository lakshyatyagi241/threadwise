import {
  REVENUE_MAX_DAYS,
  type RevenueCompare,
  type RevenueCompareMode,
  type RevenueRange,
  type RevenueRow,
} from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { addDays, daysBetween, zonedMidnight } from '../crm-dashboard/zoned-calendar';

/**
 * The pure parts of the revenue report: the period (cut in the viewer's zone) and its comparison window. No I/O, so the calendar
 * cases (month ends, leap days, daylight-saving changes) are pinned by unit tests.
 */

export interface Window {
  /** Inclusive local dates. */
  fromDate: string;
  toDate: string;
  /** The instants the window is cut at: [from, toExclusive). */
  from: Date;
  toExclusive: Date;
}

export interface RevenuePeriod extends Window {
  range: RevenueRange;
  days: number;
  today: string;
  compare: (Window & { mode: RevenueCompareMode }) | null;
}

const ymd = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const parts = (s: string): [number, number, number] =>
  s.split('-').map(Number) as [number, number, number];

export const daysInMonth = (y: number, m: number): number =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthStart = (s: string): string => `${s.slice(0, 7)}-01`;
const quarterStart = (s: string): string => {
  const [y, m] = parts(s);
  return ymd(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
};
const yearStart = (s: string): string => `${s.slice(0, 4)}-01-01`;

/** `2026-03-31` -> `2026-02-28`: the same day of the month `n` months earlier, cut to the length of that month. */
export function addMonths(s: string, n: number): string {
  const [y, m, d] = parts(s);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

const lastDayOfMonthBefore = (s: string): string => addDays(monthStart(s), -1);

/**
 * `month`, `quarter` and `year` are that calendar period to date; `lastMonth` is the whole previous month; `30d` and `90d` are that
 * many days ending today (today included); `custom` is the given days inclusive (a missing `to` is today, a future `to` is cut to
 * today, a missing `from` is 29 days before `to`).
 */
function resolveWindowDates(
  range: RevenueRange,
  today: string,
  custom: { from?: string; to?: string },
): { fromDate: string; toDate: string } {
  switch (range) {
    case 'month':
      return { fromDate: monthStart(today), toDate: today };
    case 'lastMonth': {
      const toDate = lastDayOfMonthBefore(today);
      return { fromDate: monthStart(toDate), toDate };
    }
    case 'quarter':
      return { fromDate: quarterStart(today), toDate: today };
    case 'year':
      return { fromDate: yearStart(today), toDate: today };
    case '30d':
      return { fromDate: addDays(today, -29), toDate: today };
    case '90d':
      return { fromDate: addDays(today, -89), toDate: today };
    case 'custom': {
      const toDate = custom.to && custom.to < today ? custom.to : today;
      let fromDate = custom.from ?? addDays(toDate, -29);
      if (fromDate > toDate) fromDate = toDate;
      return { fromDate, toDate };
    }
  }
}

/**
 * The window a comparison looks at.
 *  - `lastYear`: the same dates one year earlier (29 February becomes 28 February).
 *  - `previous` for a calendar range (month, quarter, year to date; last month): the same stretch of the calendar period before, so
 *    1-15 October is set against 1-15 September (cut to the length of the shorter month), not against 17-30 September.
 *  - `previous` for a rolling range (30d, 90d, custom): the window of the same length that ends the day before this one starts.
 */
function resolveCompareDates(
  mode: RevenueCompareMode,
  range: RevenueRange,
  cur: { fromDate: string; toDate: string },
  days: number,
): { fromDate: string; toDate: string } {
  if (mode === 'lastYear') {
    return { fromDate: addMonths(cur.fromDate, -12), toDate: addMonths(cur.toDate, -12) };
  }
  if (range === 'lastMonth') {
    const fromDate = addMonths(cur.fromDate, -1);
    return { fromDate, toDate: lastDayOfMonthBefore(cur.fromDate) };
  }
  const calendarStep = range === 'month' ? 1 : range === 'quarter' ? 3 : range === 'year' ? 12 : 0;
  if (calendarStep > 0) {
    const fromDate = addMonths(cur.fromDate, -calendarStep);
    const periodEnd = addDays(cur.fromDate, -1);
    const toDate = addDays(fromDate, days - 1);
    return { fromDate, toDate: toDate > periodEnd ? periodEnd : toDate };
  }
  return { fromDate: addDays(cur.fromDate, -days), toDate: addDays(cur.fromDate, -1) };
}

const windowOf = (fromDate: string, toDate: string, tz: string): Window => ({
  fromDate,
  toDate,
  from: zonedMidnight(fromDate, tz),
  toExclusive: zonedMidnight(addDays(toDate, 1), tz),
});

export function resolveRevenuePeriod(
  range: RevenueRange,
  compare: RevenueCompare,
  tz: string,
  today: string,
  custom: { from?: string; to?: string } = {},
): RevenuePeriod {
  const { fromDate, toDate } = resolveWindowDates(range, today, custom);
  const days = daysBetween(fromDate, toDate) + 1;
  if (days > REVENUE_MAX_DAYS) {
    throw AppError.validation(`The period can cover at most ${REVENUE_MAX_DAYS} days.`, [
      { path: 'from', message: `at most ${REVENUE_MAX_DAYS} days` },
    ]);
  }
  const cmp =
    compare === 'none'
      ? null
      : (() => {
          const w = resolveCompareDates(compare, range, { fromDate, toDate }, days);
          return { mode: compare, ...windowOf(w.fromDate, w.toDate, tz) };
        })();
  return { range, days, today, compare: cmp, ...windowOf(fromDate, toDate, tz) };
}

/** A period an export fixed when it was asked for: its dates and its comparison, without the clock. */
export interface FrozenPeriod {
  range: RevenueRange;
  fromDate: string;
  toDate: string;
  compare: { mode: RevenueCompareMode; fromDate: string; toDate: string } | null;
}

/** The period of a stored export: the dates are taken as they are, only the instants are cut again in the stored zone. */
export function revenuePeriodOf(frozen: FrozenPeriod, tz: string, today: string): RevenuePeriod {
  return {
    range: frozen.range,
    days: daysBetween(frozen.fromDate, frozen.toDate) + 1,
    today,
    compare: frozen.compare
      ? {
          mode: frozen.compare.mode,
          ...windowOf(frozen.compare.fromDate, frozen.compare.toDate, tz),
        }
      : null,
    ...windowOf(frozen.fromDate, frozen.toDate, tz),
  };
}

/** Rows come back keyed; the table lists the biggest invoiced first (then collected), the rest of the order is by label. */
export function compareRows(
  a: { rank: bigint; collected: bigint; row: Pick<RevenueRow, 'label' | 'key'> },
  b: { rank: bigint; collected: bigint; row: Pick<RevenueRow, 'label' | 'key'> },
): number {
  if (a.rank !== b.rank) return a.rank > b.rank ? -1 : 1;
  if (a.collected !== b.collected) return a.collected > b.collected ? -1 : 1;
  return (a.row.label ?? a.row.key).localeCompare(b.row.label ?? b.row.key);
}
