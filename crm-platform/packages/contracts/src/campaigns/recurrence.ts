import { z } from 'zod';

/**
 * Recurrence maths of a recurring broadcast, shared by the API (the worker plans the next run from it) and the web wizard (the
 * "Repeats every week" banner and the "next runs" preview), so what the person sees is what the worker will do.
 *
 * Everything works on calendar dates (`YYYY-MM-DD`) and a wall-clock time read in the rule's own IANA zone, and only the very last step
 * turns a (date, time, zone) triple into a UTC instant. Dates are never advanced by adding 24-hour blocks: that is what makes 09:00 stay
 * 09:00 on both sides of a daylight-saving change. No function here reads the clock or the machine's time zone.
 */

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];
/** "Repeat every N": a year of daily runs is the most that is ever meaningful. */
export const RECURRENCE_INTERVAL_MAX = 365;
export const RECURRENCE_AFTER_MAX = 1000;

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((v) => {
    const t = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v;
  }, 'is not a real date');
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm (24 hour)');

/** True when the runtime knows the IANA zone (`Asia/Kolkata`). */
export function isIanaTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
const zoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isIanaTimeZone, 'unknown time zone (use an IANA name such as Asia/Kolkata)');

export const recurrenceEndsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('never') }),
  /** The last day (inclusive, on the rule's calendar) a run may fall on. */
  z.object({ kind: z.literal('on_date'), date: dateOnly }),
  /** Stops after this many runs, counted from the first one. */
  z.object({
    kind: z.literal('after'),
    occurrences: z.number().int().min(1).max(RECURRENCE_AFTER_MAX),
  }),
]);
export type RecurrenceEnds = z.infer<typeof recurrenceEndsSchema>;

export const recurrenceRuleSchema = z
  .object({
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    /** Every N days, weeks or months. */
    interval: z.number().int().min(1).max(RECURRENCE_INTERVAL_MAX),
    /** First day a run may fall on (a calendar date in `timezone`). */
    startDate: dateOnly,
    timeOfDay,
    timezone: zoneSchema,
    /** Weekly only. 0 is Sunday, 6 is Saturday. Empty means the weekday of `startDate`. */
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    /** Monthly only: the day of the month. Empty means the day of `startDate`; a short month uses its last day. */
    monthDay: z.number().int().min(1).max(31).nullish(),
    ends: recurrenceEndsSchema.default({ kind: 'never' }),
  })
  .superRefine((r, ctx) => {
    if (r.ends.kind === 'on_date' && r.ends.date < r.startDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['ends', 'date'],
        message: 'The end date is before the start date',
      });
    }
    if (r.frequency === 'weekly' && new Set(r.weekdays).size !== r.weekdays.length) {
      ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Each weekday once' });
    }
  });
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;
/** The rule as a form holds it, before the defaults are applied. */
export type RecurrenceRuleInput = z.input<typeof recurrenceRuleSchema>;

// --------------------------------------------------------------------------- calendar helpers

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const fmt = (d: Date) => `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (date: string): Date => new Date(`${date}T00:00:00Z`);

/** `date` moved by `days` calendar days. */
export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

/** 0 (Sunday) to 6 (Saturday). */
export function weekdayOf(date: string): number {
  return parse(date).getUTCDay();
}

const daysInMonth = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

/** The offset of `zone` at `instant` (ms since the epoch), in ms. */
function zoneOffsetMs(zone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * A wall-clock time in a zone as the UTC instant it names. Two passes settle the offset next to a daylight-saving change. A time
 * that does not exist (02:30 on the spring-forward day) lands on the first instant after the gap, so the run is late by the length of
 * the gap and never skipped; a time that happens twice (the fall-back hour) takes its first occurrence.
 */
export function zonedTimeToUtc(date: string, time: string, zone: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let utc = naive - zoneOffsetMs(zone, naive);
  utc = naive - zoneOffsetMs(zone, utc);
  // A wall time inside the spring-forward gap does not round-trip; take the instant the gap ends at.
  const back = zoneOffsetMs(zone, utc);
  if (utc + back !== naive) {
    const before = zoneOffsetMs(zone, naive - 86_400_000);
    const after = zoneOffsetMs(zone, naive + 86_400_000);
    if (before !== after) utc = naive - before;
  }
  // A time that happens twice (fall back): the first of the two.
  const earlier = utc - 3_600_000;
  if (zoneOffsetMs(zone, earlier) !== zoneOffsetMs(zone, utc) && earlier + zoneOffsetMs(zone, earlier) === naive) {
    utc = earlier;
  }
  return new Date(utc);
}

/** The calendar date on the clock of `zone` at `instant`. */
export function dateInZone(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

// --------------------------------------------------------------------------- the sequence

/** The weekdays a weekly rule runs on, sorted. The weekday of the start date when none were picked. */
export function effectiveWeekdays(rule: Pick<RecurrenceRule, 'weekdays' | 'startDate'>): number[] {
  const days = rule.weekdays.length > 0 ? rule.weekdays : [weekdayOf(rule.startDate)];
  return [...new Set(days)].sort((a, b) => a - b);
}

/** The day of the month a monthly rule runs on. */
export function effectiveMonthDay(rule: Pick<RecurrenceRule, 'monthDay' | 'startDate'>): number {
  return rule.monthDay ?? Number(rule.startDate.slice(8, 10));
}

/**
 * The calendar date of the `index`th run (0 is the first), or null when the rule has ended before it: after `after N` runs, or
 * past the `on_date` day. A weekly rule counts runs in date order across the picked weekdays; "every 2 weeks" runs the picked
 * weekdays of the start week, then of the week two later, and so on (weeks start on Sunday). A monthly rule on the 31st runs on
 * the last day of a shorter month.
 */
export function recurrenceDateAt(rule: RecurrenceRule, index: number): string | null {
  if (index < 0) return null;
  if (rule.ends.kind === 'after' && index >= rule.ends.occurrences) return null;
  const date = nthDate(rule, index);
  if (date === null) return null;
  if (rule.ends.kind === 'on_date' && date > rule.ends.date) return null;
  return date;
}

function nthDate(rule: RecurrenceRule, index: number): string | null {
  const { frequency, interval, startDate } = rule;
  if (frequency === 'daily') return addDays(startDate, index * interval);

  if (frequency === 'weekly') {
    const days = effectiveWeekdays(rule);
    const weekStart = addDays(startDate, -weekdayOf(startDate));
    let seen = 0;
    // A week with no day on or after the start date yields nothing; the loop is bounded by the largest possible index.
    for (let w = 0; w <= index + 2; w++) {
      const base = addDays(weekStart, w * interval * 7);
      for (const wd of days) {
        const date = addDays(base, wd);
        if (date < startDate) continue;
        if (seen === index) return date;
        seen++;
      }
    }
    return null;
  }

  const day = effectiveMonthDay(rule);
  const sy = Number(startDate.slice(0, 4));
  const sm = Number(startDate.slice(5, 7)) - 1;
  let seen = 0;
  for (let k = 0; k <= index + 2; k++) {
    const total = sm + k * interval;
    const year = sy + Math.floor(total / 12);
    const month = ((total % 12) + 12) % 12;
    const date = `${pad(year, 4)}-${pad(month + 1)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
    if (date < startDate) continue;
    if (seen === index) return date;
    seen++;
  }
  return null;
}

export interface Occurrence {
  /** 0-based position in the series. */
  index: number;
  /** The date on the rule's calendar. */
  date: string;
  /** When it is due. */
  at: Date;
}

/** The `index`th run: its date and the UTC instant it is due. Null when the rule ended before it. */
export function occurrenceAt(rule: RecurrenceRule, index: number): Occurrence | null {
  const date = recurrenceDateAt(rule, index);
  if (date === null) return null;
  return { index, date, at: zonedTimeToUtc(date, rule.timeOfDay, rule.timezone) };
}

/** The next `count` runs from `fromIndex`, for the wizard's preview. */
export function upcomingOccurrences(rule: RecurrenceRule, count: number, fromIndex = 0): Occurrence[] {
  const out: Occurrence[] = [];
  for (let i = fromIndex; out.length < count; i++) {
    const o = occurrenceAt(rule, i);
    if (!o) break;
    out.push(o);
  }
  return out;
}

/**
 * The first run due at or after `notBefore`, searching from `fromIndex`. Runs that fell before it are returned as `skipped` (the
 * planner uses this to step over occurrences a long outage made stale instead of sending them all at once). Null `next` when the
 * rule has ended.
 */
export function firstDueFrom(
  rule: RecurrenceRule,
  fromIndex: number,
  notBefore: Date,
): { next: Occurrence | null; skipped: number } {
  let skipped = 0;
  for (let i = fromIndex; ; i++) {
    const o = occurrenceAt(rule, i);
    if (!o) return { next: null, skipped };
    if (o.at.getTime() >= notBefore.getTime()) return { next: o, skipped };
    skipped++;
    // Stop scanning a rule that is years behind; the caller asks again from here.
    if (skipped > 5000) return { next: o, skipped };
  }
}
