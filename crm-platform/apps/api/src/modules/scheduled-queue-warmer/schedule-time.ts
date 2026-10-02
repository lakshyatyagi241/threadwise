import { wallTimeToUtc } from '../broadcasts';

/**
 * When a scheduled message runs, and when it runs next (TW-NODE-030, 032). Pure.
 *
 * Laravel kept the next run (`next_run_at`) on the row and advanced it after every run (`ScheduledMessage::advanceRecurring`);
 * the bridge built a separate cron that ignored `repeat_every` and stopped before the end date. The row's rules are what a
 * user sees on screen, so they are the ones kept: every N days, the next allowed weekday, every N months without overflow,
 * and the end date inclusive to the end of that day. All of it is read as wall time in the schedule's own zone.
 */

export type RepeatInterval = 'daily' | 'weekly' | 'monthly';

export interface Recurrence {
  repeatInterval: string | null;
  /** Every N days, weeks or months. Reference's `repeat_every`, 0 or blank meaning 1. */
  repeatEvery: number;
  /** 0 = Sunday ... 6 = Saturday. Empty means "every week on the same weekday". */
  daysOfWeek: readonly number[];
  /** `YYYY-MM-DD`, inclusive: a run on this day still happens. */
  endDate: string | null;
  timezone: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` and `HH:mm` of an instant, as read on a wall clock in `zone`. */
export function wallParts(
  instant: Date,
  zone: string,
): { date: string; time: string; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    weekday,
  };
}

const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

/** Carbon's `addMonthsNoOverflow`: Jan 31 plus one month is Feb 28 (or 29), never Mar 3. */
const addMonthsNoOverflow = (date: string, n: number): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`;
};

const weekdayOf = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/**
 * The run after `current`, or null when the recurrence is over (unknown interval, no allowed weekday within 14 days, or the
 * next run would fall after the end date). `current` is the run that just happened.
 */
export function nextRun(current: Date, r: Recurrence): Date | null {
  const every = r.repeatEvery > 0 ? r.repeatEvery : 1;
  const { date, time } = wallParts(current, r.timezone);
  let nextDate: string | null;
  switch (r.repeatInterval) {
    case 'daily':
      nextDate = addDays(date, every);
      break;
    case 'weekly': {
      const days = [...new Set(r.daysOfWeek.map(Number))].sort((a, b) => a - b);
      if (days.length === 0) {
        nextDate = addDays(date, 7 * every);
        break;
      }
      nextDate = null;
      // The next allowed weekday, looking at most 14 days ahead (as Laravel does).
      for (let i = 1; i <= 14; i++) {
        const candidate = addDays(date, i);
        if (days.includes(weekdayOf(candidate))) {
          nextDate = candidate;
          break;
        }
      }
      break;
    }
    case 'monthly':
      nextDate = addMonthsNoOverflow(date, every);
      break;
    default:
      return null;
  }
  if (!nextDate) return null;
  if (r.endDate && nextDate > r.endDate) return null; // the end date itself still runs, to the end of that day
  return wallTimeToUtc(nextDate, time, r.timezone);
}

/** Within this long of now (or already past) a one-off runs at once: a cron for "this minute" would not fire (TW-NODE-030 rule 3). */
export const FIRE_NOW_WINDOW_MS = 5_000;

export const isDue = (at: Date, now: Date) => at.getTime() - now.getTime() <= FIRE_NOW_WINDOW_MS;

/** Whole minutes `at` is behind `now`; 0 when it is not yet due. */
export const minutesLate = (at: Date, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
