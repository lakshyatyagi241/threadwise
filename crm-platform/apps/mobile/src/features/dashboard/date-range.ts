import {
  addDays,
  compareDates,
  formatDate,
  isDateString,
  spanDays,
} from '@/components/ui/calendar-range.dates';

/** The dates the person picks on the dashboard's calendar. Pure. Days are 'YYYY-MM-DD' calendar days in the workspace's zone, both ends included. */

export type DateRange = { from: string; to: string };

/** The quick choices above the calendar. */
export const PRESETS = ['today', 'yesterday', 'last7', 'last30', 'last90'] as const;
export type Preset = (typeof PRESETS)[number];

/** What the dashboard shows until a range is chosen, and what "Reset" goes back to. */
export const DEFAULT_PRESET: Preset = 'last30';

/** The most calendar days a range may cover (the API refuses a longer one with 422). */
export const MAX_SPAN_DAYS = 366;

/** The days a "last N days" preset covers, today included. */
const LAST_DAYS = { last7: 7, last30: 30, last90: 90 } as const;

/** The calendar day it is in `timeZone` (an IANA name such as 'Asia/Kolkata') at `now`. A missing or unknown zone reads as UTC. */
export function todayIn(timeZone: string | undefined, now: Date = new Date()): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now);
      const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      const day = formatDate(part('year'), part('month'), part('day'));
      if (isDateString(day)) return day;
    } catch {
      // An unknown zone name: fall through to UTC.
    }
  }
  return formatDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}

/** The range a preset stands for, counted back from `today`: "last 30 days" is the 30 days that end today. */
export function presetRange(preset: Preset, today: string): DateRange {
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'yesterday') {
    const yesterday = addDays(today, -1);
    return { from: yesterday, to: yesterday };
  }
  return { from: addDays(today, 1 - LAST_DAYS[preset]), to: today };
}

/** Which preset a range is exactly, or null for a range of the person's own. */
export function presetOf(range: DateRange, today: string): Preset | null {
  return (
    PRESETS.find((preset) => {
      const candidate = presetRange(preset, today);
      return candidate.from === range.from && candidate.to === range.to;
    }) ?? null
  );
}

/** Real days, the first not after the last, the last not after today, and no more than `MAX_SPAN_DAYS` days. */
export function isValidRange(range: DateRange, today: string): boolean {
  return (
    isDateString(range.from) &&
    isDateString(range.to) &&
    isDateString(today) &&
    compareDates(range.from, range.to) <= 0 &&
    compareDates(range.to, today) <= 0 &&
    spanDays(range.from, range.to) <= MAX_SPAN_DAYS
  );
}
