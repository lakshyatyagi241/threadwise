/**
 * Time-zone arithmetic for the slot engine (TW-APPT-017, D-01). No library: the platform's own tz database through `Intl`.
 *
 * The one rule that makes daylight saving behave: a WALL time (a calendar date and a clock time in a zone) becomes an INSTANT, and
 * from then on everything is done in real elapsed minutes. A wall time that does not exist (the spring-forward gap) shifts forward by
 * the length of the gap, as every mainstream calendar does; a wall time that happens twice (the fall-back overlap) takes its first
 * occurrence. Calendar-date arithmetic (next day, weekday) is done on the date itself, never on instants, so a 23- or 25-hour day
 * cannot skip or repeat a date.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The zone's offset from UTC at an instant, in milliseconds (east is positive). */
export function offsetMs(instantMs: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const part of parts(tz).formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  // The formatter has no sub-second part: compare against the instant truncated to the second.
  return wall - Math.floor(instantMs / 1000) * 1000;
}

export interface LocalDate {
  y: number;
  m: number;
  d: number;
}

export function parseLocalDate(s: string): LocalDate {
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) };
}

export function formatLocalDate(l: LocalDate): string {
  return `${String(l.y).padStart(4, '0')}-${String(l.m).padStart(2, '0')}-${String(l.d).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` plus a number of calendar days. */
export function addDays(date: string, n: number): string {
  const l = parseLocalDate(date);
  const t = new Date(Date.UTC(l.y, l.m - 1, l.d + n));
  return formatLocalDate({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/** Whole days from `a` to `b` (both `YYYY-MM-DD`). */
export function daysBetween(a: string, b: string): number {
  const x = parseLocalDate(a);
  const y = parseLocalDate(b);
  return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / DAY);
}

/** 0 = Sunday ... 6 = Saturday, of a calendar date. */
export function weekdayOf(date: string): number {
  const l = parseLocalDate(date);
  return new Date(Date.UTC(l.y, l.m - 1, l.d)).getUTCDay();
}

/** The calendar date an instant falls on in a zone. */
export function localDateOf(instantMs: number, tz: string): string {
  const p: Record<string, number> = {};
  for (const part of parts(tz).formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return formatLocalDate({ y: p.year!, m: p.month!, d: p.day! });
}

/**
 * The instant of a wall time. `minutes` is minutes after local midnight (0..1439).
 * A gap shifts forward; an overlap takes the first occurrence.
 */
export function wallToInstant(date: string, minutes: number, tz: string): number {
  const l = parseLocalDate(date);
  const wall = Date.UTC(l.y, l.m - 1, l.d, 0, minutes);
  const before = offsetMs(wall - DAY, tz);
  const after = offsetMs(wall + DAY, tz);
  const candidates = [...new Set([wall - before, wall - after])].filter(
    (c) => offsetMs(c, tz) === wall - c,
  );
  if (candidates.length > 0) return Math.min(...candidates);
  // In the gap: read the wall time with the offset that applied before it, which lands after the gap.
  return wall - before;
}

/** The instant a local calendar day begins. */
export function startOfLocalDay(date: string, tz: string): number {
  return wallToInstant(date, 0, tz);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Reference's label: "Mon 3 Jun · 9:00 AM", in the given zone. */
export function formatSlotLabel(instantMs: number, tz: string): string {
  const date = localDateOf(instantMs, tz);
  const l = parseLocalDate(date);
  return `${WEEKDAYS[weekdayOf(date)]} ${l.d} ${MONTHS[l.m - 1]} · ${formatClock(instantMs, tz)}`;
}

export function formatClock(instantMs: number, tz: string): string {
  const mins = Math.round((instantMs + offsetMs(instantMs, tz)) / MINUTE);
  const m = ((mins % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** "Mon 3 Jun 2026". */
export function formatDateLong(instantMs: number, tz: string): string {
  const date = localDateOf(instantMs, tz);
  const l = parseLocalDate(date);
  return `${WEEKDAYS[weekdayOf(date)]} ${l.d} ${MONTHS[l.m - 1]} ${l.y}`;
}

/** Month key `YYYY-MM` an instant falls in, in a zone (the plan cap's month). */
export function localMonthOf(instantMs: number, tz: string): string {
  return localDateOf(instantMs, tz).slice(0, 7);
}

/** The instants a local month begins and ends (end exclusive). */
export function monthBounds(month: string, tz: string): { startMs: number; endMs: number } {
  const first = `${month}-01`;
  const l = parseLocalDate(first);
  const next = formatLocalDate({
    y: l.m === 12 ? l.y + 1 : l.y,
    m: l.m === 12 ? 1 : l.m + 1,
    d: 1,
  });
  return { startMs: startOfLocalDay(first, tz), endMs: startOfLocalDay(next, tz) };
}
