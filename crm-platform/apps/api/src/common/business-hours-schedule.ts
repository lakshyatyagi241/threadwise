import {
  BUSINESS_HOURS_DAY_KEYS,
  businessHoursDaySchema,
  businessHoursHolidaySchema,
  type BusinessHoursDay,
  type BusinessHoursDayInput,
  type BusinessHoursDays,
  type BusinessHoursHoliday,
} from '@crm/contracts';
import { parseBusinessHours } from './business-hours';

/**
 * The saved weekly schedule as the settings screens read and write it (the Auto-assignment dialog and the Settings "Working hours"
 * card share it). Pure functions, so the rules that decide what is shown and saved are unit-testable without a database.
 */

/** Reference's default: Monday to Friday 09:00-18:00, Saturday and Sunday closed. Shown until a schedule is saved. */
export function defaultBusinessHoursDays(): BusinessHoursDays {
  const day = (enabled: boolean): BusinessHoursDayInput => ({
    enabled,
    from: '09:00',
    to: '18:00',
  });
  return {
    mon: day(true),
    tue: day(true),
    wed: day(true),
    thu: day(true),
    fri: day(true),
    sat: day(false),
    sun: day(false),
  };
}

/**
 * The days as they should be shown: a saved window that is well formed is kept, anything else (a missing day, a malformed time, a
 * window with equal times, overlapping windows) falls back to the default for that day, as Reference's form does.
 */
export function readBusinessHoursDays(raw: unknown): BusinessHoursDays {
  const stored = parseBusinessHours(raw)?.days ?? {};
  const fallback = defaultBusinessHoursDays();
  const out = {} as BusinessHoursDays;
  for (const key of BUSINESS_HOURS_DAY_KEYS) {
    const parsed = businessHoursDaySchema.safeParse(stored[key]);
    out[key] = parsed.success ? parsed.data : fallback[key];
  }
  return out;
}

/** The saved holidays that are real dates, once each, oldest first. Anything malformed is dropped. */
export function readBusinessHoursHolidays(raw: unknown): BusinessHoursHoliday[] {
  const list = parseBusinessHours(raw)?.holidays;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: BusinessHoursHoliday[] = [];
  for (const item of list) {
    const parsed = businessHoursHolidaySchema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.date)) continue;
    seen.add(parsed.data.date);
    out.push(parsed.data);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The JSON text written to `workspace_settings.business_hours`: the new days (and the holidays, when given) over whatever else is
 * stored with the schedule (the outside-hours reply and the anti-spam keys Reference keeps there, which are not owned here).
 */
export function mergeBusinessHours(
  priorRaw: unknown,
  days: BusinessHoursDays,
  holidays?: BusinessHoursHoliday[],
): string {
  const prior = parseBusinessHours(priorRaw) ?? {};
  const next: Record<string, unknown> = { ...prior, days };
  if (holidays !== undefined) {
    const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length > 0) next.holidays = sorted;
    else delete next.holidays;
  }
  return JSON.stringify(next);
}

const sameWindows = (a: BusinessHoursDayInput, b: BusinessHoursDayInput): boolean => {
  const x = a.extra ?? [];
  const y = b.extra ?? [];
  return x.length === y.length && x.every((w, i) => w.from === y[i]!.from && w.to === y[i]!.to);
};

export function sameDays(a: BusinessHoursDays, b: BusinessHoursDays): boolean {
  return BUSINESS_HOURS_DAY_KEYS.every((k: BusinessHoursDay) => {
    const x = a[k];
    const y = b[k];
    return x.enabled === y.enabled && x.from === y.from && x.to === y.to && sameWindows(x, y);
  });
}

export function sameHolidays(a: BusinessHoursHoliday[], b: BusinessHoursHoliday[]): boolean {
  return (
    a.length === b.length &&
    a.every((h, i) => h.date === b[i]!.date && (h.label ?? '') === (b[i]!.label ?? ''))
  );
}
