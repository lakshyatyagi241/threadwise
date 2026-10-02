import { addDays, formatClock, parseClock, parseDayKey, weekdayOf } from './zone';

/**
 * The editor's model of a booking type's weekly hours and its date overrides. Pure: the components only draw it. Weekdays use
 * Reference's numbering (0 = Sunday ... 6 = Saturday); the editor lists them Monday first.
 */

export interface Interval {
  /** Stable key for React; never sent to the API. */
  id: string;
  /** 24-hour "HH:MM", or '' while the box is empty. */
  from: string;
  to: string;
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type WeeklyHours = Record<Weekday, Interval[]>;

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];
export const MAX_INTERVALS_PER_DAY = 6;

let counter = 0;
export const newId = (): string => `i${(counter += 1)}`;

export const emptyWeek = (): WeeklyHours => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });

/** Monday to Friday, 09:00 to 18:00: Reference's default business hours. */
export function defaultWeek(): WeeklyHours {
  const w = emptyWeek();
  for (const d of [1, 2, 3, 4, 5] as const) w[d] = [{ id: newId(), from: '09:00', to: '18:00' }];
  return w;
}

export interface WireRule {
  weekday: number;
  from: string;
  to: string;
}

/** The API's flat rules as the editor's week; rules with an unreadable weekday or time are dropped. */
export function weekFromRules(rules: readonly WireRule[]): WeeklyHours {
  const w = emptyWeek();
  for (const r of rules) {
    if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) continue;
    w[r.weekday as Weekday].push({ id: newId(), from: r.from.slice(0, 5), to: r.to.slice(0, 5) });
  }
  for (const d of WEEKDAYS) w[d] = sortIntervals(w[d]);
  return w;
}

/** The week as the API's flat rules: empty or unfinished rows are left out, the rest are sorted by day then time. */
export function rulesFromWeek(week: WeeklyHours): WireRule[] {
  const out: WireRule[] = [];
  for (const d of WEEKDAYS) {
    for (const iv of sortIntervals(week[d])) {
      if (parseClock(iv.from) !== null && parseClock(iv.to) !== null)
        out.push({ weekday: d, from: iv.from, to: iv.to });
    }
  }
  return out;
}

/** Earliest first; rows without a readable start go last. */
export function sortIntervals(list: readonly Interval[]): Interval[] {
  return [...list].sort((a, b) => (parseClock(a.from) ?? 9999) - (parseClock(b.from) ?? 9999));
}

export type IntervalProblem = 'incomplete' | 'order' | 'overlap';

/**
 * What is wrong with each row of a day, by row id: a box left empty ('incomplete'), an end that is not after the start
 * ('order'), or a row that overlaps another ('overlap'). A day with no rows is fine: it is closed.
 */
export function dayProblems(list: readonly Interval[]): Map<string, IntervalProblem> {
  const out = new Map<string, IntervalProblem>();
  const parsed = list.map((iv) => ({ iv, from: parseClock(iv.from), to: parseClock(iv.to) }));
  for (const p of parsed) {
    if (p.from === null || p.to === null) out.set(p.iv.id, 'incomplete');
    else if (p.to <= p.from) out.set(p.iv.id, 'order');
  }
  const ok = parsed.filter((p) => !out.has(p.iv.id)) as Array<{
    iv: Interval;
    from: number;
    to: number;
  }>;
  ok.sort((a, b) => a.from - b.from);
  for (let i = 1; i < ok.length; i++) {
    if (ok[i]!.from < ok[i - 1]!.to) {
      out.set(ok[i]!.iv.id, 'overlap');
      out.set(ok[i - 1]!.iv.id, 'overlap');
    }
  }
  return out;
}

export const weekHasProblems = (week: WeeklyHours): boolean =>
  WEEKDAYS.some((d) => dayProblems(week[d]).size > 0);

/** Does the week open at all? A booking type with no hours has no bookable times. */
export const weekIsEmpty = (week: WeeklyHours): boolean => rulesFromWeek(week).length === 0;

/** Adds a row after the last one: an hour starting where the previous ended (or 09:00 to 17:00 on an empty day). */
export function addInterval(list: readonly Interval[]): Interval[] {
  if (list.length >= MAX_INTERVALS_PER_DAY) return [...list];
  const last = sortIntervals(list).at(-1);
  const lastEnd = last ? parseClock(last.to) : null;
  let from = 9 * 60;
  let to = 17 * 60;
  if (lastEnd !== null) {
    from = Math.min(lastEnd + 60, 22 * 60);
    to = Math.min(from + 120, 23 * 60 + 59);
  }
  return [...list, { id: newId(), from: formatClock(from), to: formatClock(to) }];
}

/** Copies one day's hours onto other days (new row ids), replacing what they had. */
export function copyDay(week: WeeklyHours, from: Weekday, to: readonly Weekday[]): WeeklyHours {
  const next: WeeklyHours = { ...week };
  for (const d of to) {
    if (d === from) continue;
    next[d] = week[from].map((iv) => ({ id: newId(), from: iv.from, to: iv.to }));
  }
  return next;
}

/** Minutes of bookable time in a day, for the "8h" hint. Unfinished rows count for nothing. */
export function dayMinutes(list: readonly Interval[]): number {
  let total = 0;
  for (const iv of list) {
    const f = parseClock(iv.from);
    const t = parseClock(iv.to);
    if (f !== null && t !== null && t > f) total += t - f;
  }
  return total;
}

export function weekMinutes(week: WeeklyHours): number {
  let total = 0;
  for (const d of WEEKDAYS) total += dayMinutes(week[d]);
  return total;
}

// ---- date overrides ------------------------------------------------------------------------------------------------

export interface Override {
  id: string;
  /** `YYYY-MM-DD` in the booking type's zone. */
  date: string;
  closed: boolean;
  /** Custom hours when the day is open; '' while closed. */
  from: string;
  to: string;
  reason: string;
}

export interface WireOverride {
  date: string;
  closed: boolean;
  from: string | null;
  to: string | null;
  reason: string | null;
}

export const MAX_OVERRIDES = 366;
export const REASON_MAX = 120;

export function overridesFromWire(list: readonly WireOverride[]): Override[] {
  return sortOverrides(
    list
      .filter((o) => parseDayKey(o.date) !== null)
      .map((o) => ({
        id: newId(),
        date: o.date,
        closed: o.closed,
        from: o.from?.slice(0, 5) ?? '',
        to: o.to?.slice(0, 5) ?? '',
        reason: o.reason ?? '',
      })),
  );
}

export function overridesToWire(list: readonly Override[]): WireOverride[] {
  return sortOverrides(list).map((o) => ({
    date: o.date,
    closed: o.closed,
    from: o.closed ? null : o.from || null,
    to: o.closed ? null : o.to || null,
    reason: o.reason.trim() || null,
  }));
}

export const sortOverrides = <T extends { date: string }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/** Adds a closed day; a date that already has an override is left as it is. */
export function addClosedDay(list: readonly Override[], date: string, reason = ''): Override[] {
  if (
    parseDayKey(date) === null ||
    list.some((o) => o.date === date) ||
    list.length >= MAX_OVERRIDES
  )
    return [...list];
  return sortOverrides([...list, { id: newId(), date, closed: true, from: '', to: '', reason }]);
}

/** Clicking a date in the calendar: closes an open one, removes an existing override (back to the weekly hours). */
export function toggleClosedDay(list: readonly Override[], date: string): Override[] {
  return list.some((o) => o.date === date)
    ? list.filter((o) => o.date !== date)
    : addClosedDay(list, date);
}

/** A run of days (the Christmas week) closed in one go; days that already have an override keep it. */
export function addClosedRange(
  list: readonly Override[],
  from: string,
  to: string,
  reason = '',
): Override[] {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  if (!a || !b || to < from) return [...list];
  let next = [...list];
  for (let d = from, n = 0; d <= to && n < MAX_OVERRIDES; d = addDays(d, 1), n++)
    next = addClosedDay(next, d, reason);
  return next;
}

export type OverrideProblem = 'incomplete' | 'order' | 'dayClosedHours';

/** Problems by override id: an open override needs a start and an end, in order. */
export function overrideProblems(list: readonly Override[]): Map<string, OverrideProblem> {
  const out = new Map<string, OverrideProblem>();
  for (const o of list) {
    if (o.closed) continue;
    const f = parseClock(o.from);
    const t = parseClock(o.to);
    if (f === null || t === null) out.set(o.id, 'incomplete');
    else if (t <= f) out.set(o.id, 'order');
  }
  return out;
}

/**
 * How a date is bookable under the weekly hours and the overrides: 'closed' (an override closes it), 'custom' (an override
 * sets its hours), 'open' (the weekly hours have a window that weekday) or 'off' (a day the weekly hours leave closed).
 */
export function dateStatus(
  date: string,
  week: WeeklyHours,
  overrides: readonly Override[],
): 'closed' | 'custom' | 'open' | 'off' {
  const o = overrides.find((x) => x.date === date);
  if (o) return o.closed ? 'closed' : 'custom';
  const d = weekdayOf(date) as Weekday;
  return week[d].some((iv) => parseClock(iv.from) !== null && parseClock(iv.to) !== null)
    ? 'open'
    : 'off';
}
