import type { FlbScheduleConfig } from '@crm/contracts';

/** A moment read in a time zone: what a schedule compares against ("is it past 09:00 on a Monday there?"). */
export interface LocalMoment {
  /** `YYYY-MM-DD` in the zone. */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** 0 (Sunday) to 6. */
  weekday: number;
  day: number;
  daysInMonth: number;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** `now` as the wall clock of `timezone`; a zone the platform does not know is read as UTC. */
export function localMoment(now: Date, timezone: string): LocalMoment {
  let parts: Intl.DateTimeFormatPart[];
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(now);
  try {
    parts = fmt(timezone || 'UTC');
  } catch {
    parts = fmt('UTC');
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    weekday: WEEKDAYS[get('weekday')] ?? 0,
    day,
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}

export const minutesOf = (hhmm: string): number => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 540;
};

/** The day before a `YYYY-MM-DD` date. */
const dayBefore = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * The occurrence of a schedule that is due now, as a key (`YYYY-MM-DD`), or null. An occurrence is a day on which the schedule applies
 * (every day, a chosen weekday, a day of the month, or the one date), once its time of day has come; `last` is the key it last fired
 * for, so the same occurrence never fires twice. A one-off whose moment was missed fires late for a day, never for an old date. A
 * monthly schedule on the 31st fires on the last day of a shorter month.
 */
export function dueOccurrence(
  cfg: Pick<FlbScheduleConfig, 'frequency' | 'time' | 'date' | 'weekdays' | 'day'>,
  at: LocalMoment,
  last: string | null,
): string | null {
  const reached = at.minutes >= minutesOf(cfg.time);
  let key: string | null = null;
  switch (cfg.frequency) {
    case 'once':
      if (cfg.date === '') return null;
      if (cfg.date === at.date && reached) key = cfg.date;
      else if (cfg.date === dayBefore(at.date)) key = cfg.date;
      break;
    case 'daily':
      if (reached) key = at.date;
      break;
    case 'weekly':
      if (reached && cfg.weekdays.includes(at.weekday)) key = at.date;
      break;
    case 'monthly':
      if (reached && Math.min(cfg.day, at.daysInMonth) === at.day) key = at.date;
      break;
  }
  return key !== null && key !== last ? key : null;
}

/** The day a daily check is due for (its time of day has come and it has not run today), or null. */
export function dueDay(time: string, at: LocalMoment, last: string | null): string | null {
  return at.minutes >= minutesOf(time) && at.date !== last ? at.date : null;
}
