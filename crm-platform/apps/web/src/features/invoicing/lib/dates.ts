/** Calendar helpers. A "day" is `YYYY-MM-DD` with no time; it never shifts with the viewer's time zone. */

/** `YYYY-MM-DD` of an instant on the calendar of `timeZone` (the viewer's zone when absent). */
export function todayKey(now: Date, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return timeZone ? todayKey(now) : now.toISOString().slice(0, 10);
  }
}

const DAY_MS = 86_400_000;
const utc = (day: string): number => Date.parse(`${day.slice(0, 10)}T00:00:00Z`);

export const isDay = (v: string | null | undefined): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10)) && !Number.isNaN(utc(v));

/** The day `n` days after `day` (negative goes back). */
export function addDays(day: string, n: number): string {
  return new Date(utc(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** "5 Oct 2026" for a calendar day. */
export function formatDay(day: string | null | undefined, locale: string): string {
  if (!isDay(day)) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(utc(day)));
  } catch {
    return day.slice(0, 10);
  }
}

/** Medium date and short time in `timeZone`; empty for a missing or unparseable value. */
export function formatDateTime(iso: string | null | undefined, locale: string, timeZone?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timeZone || undefined,
    }).format(d);
  } catch {
    return '';
  }
}

/** Payment terms in days (Net 30) the due-date select offers; 0 is "due on receipt". */
export const TERM_DAYS = [0, 7, 14, 15, 30, 45, 60] as const;

/** Due date for an issue date and a term in days. */
export const dueFrom = (issueDay: string, termDays: number): string => addDays(issueDay, termDays);

/** The term in days that turns `issueDay` into `dueDay`, when it is one of the standard terms; otherwise null (custom). */
export function termOf(issueDay: string, dueDay: string): number | null {
  const n = daysBetween(issueDay, dueDay);
  return (TERM_DAYS as readonly number[]).includes(n) ? n : null;
}
