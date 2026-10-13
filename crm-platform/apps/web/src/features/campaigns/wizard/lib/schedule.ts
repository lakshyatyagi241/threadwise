import {
  addDays,
  dateInZone,
  effectiveMonthDay,
  effectiveWeekdays,
  isIanaTimeZone,
  recurrenceRuleSchema,
  type RecurrenceFrequency,
  type RecurrenceRule,
  type WizardSchedule,
} from '@crm/contracts';

export const DEFAULT_SEND_TIME = '09:00';

/** The zone a schedule starts in: the person's (their own, else the workspace's: the session's `effectiveTimezone`), else UTC. */
export function defaultTimeZone(zone: string | null | undefined): string {
  return zone && isIanaTimeZone(zone) ? zone : 'UTC';
}

export const tomorrowIn = (zone: string, now: Date): string => addDays(dateInZone(now, zone), 1);

export function defaultRule(zone: string, now: Date): RecurrenceRule {
  return {
    frequency: 'weekly',
    interval: 1,
    startDate: tomorrowIn(zone, now),
    timeOfDay: DEFAULT_SEND_TIME,
    timezone: zone,
    weekdays: [],
    monthDay: null,
    ends: { kind: 'never' },
  };
}

/** A schedule of the chosen mode with sensible fields: the person only adjusts them. A mode already chosen is kept as it is. */
export function scheduleForMode(
  mode: WizardSchedule['mode'],
  current: WizardSchedule,
  zone: string,
  now: Date,
): WizardSchedule {
  if (mode === current.mode) return current;
  if (mode === 'now') return { mode: 'now' };
  if (mode === 'scheduled') {
    return { mode, date: tomorrowIn(zone, now), time: DEFAULT_SEND_TIME, timezone: zone };
  }
  return { mode, rule: defaultRule(zone, now) };
}

/** The zone a schedule is read in (UTC for "now"), for showing the times of a launched broadcast on its own clock. */
export const scheduleZone = (s: WizardSchedule): string =>
  s.mode === 'scheduled' ? s.timezone : s.mode === 'recurring' ? s.rule.timezone : 'UTC';

/** The button of the last step. */
export type LaunchKind = 'now' | 'schedule' | 'recurring';
export const launchKind = (s: WizardSchedule): LaunchKind =>
  s.mode === 'now' ? 'now' : s.mode === 'scheduled' ? 'schedule' : 'recurring';

/**
 * The rule changed to a frequency: weekly keeps picked weekdays, monthly keeps nothing but the day of the month, and each leaves
 * the other's field cleared so a stale value never rides along.
 */
export function ruleWithFrequency(
  rule: RecurrenceRule,
  frequency: RecurrenceFrequency,
): RecurrenceRule {
  if (frequency === rule.frequency) return rule;
  return {
    ...rule,
    frequency,
    weekdays: frequency === 'weekly' ? rule.weekdays : [],
    monthDay: frequency === 'monthly' ? (rule.monthDay ?? null) : null,
  };
}

/** Toggles a weekday in a weekly rule; the list stays sorted and never repeats a day. */
export function toggleWeekday(rule: RecurrenceRule, day: number): RecurrenceRule {
  const set = new Set(rule.weekdays);
  if (set.has(day)) set.delete(day);
  else set.add(day);
  return { ...rule, weekdays: [...set].sort((a, b) => a - b) };
}

/** The rule when it is complete enough for the shared maths (`upcomingOccurrences`), else null. */
export function validRule(rule: RecurrenceRule): RecurrenceRule | null {
  const r = recurrenceRuleSchema.safeParse(rule);
  return r.success ? r.data : null;
}

/** Everything the words about a rule are built from, with the defaults the worker applies already filled in. */
export interface RecurrenceFacts {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: number[];
  monthDay: number;
  startDate: string;
  time: string;
  zone: string;
  ends: RecurrenceRule['ends'];
}

export function recurrenceFacts(rule: RecurrenceRule): RecurrenceFacts {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    weekdays: rule.frequency === 'weekly' ? effectiveWeekdays(rule) : [],
    monthDay: effectiveMonthDay(rule),
    startDate: rule.startDate,
    time: rule.timeOfDay,
    zone: rule.timezone,
    ends: rule.ends,
  };
}

/** A calendar date (`2026-10-06`) as a Date at midnight UTC, for formatting with `timeZone: 'UTC'`. */
export const dateOnlyToDate = (date: string): Date => new Date(`${date}T00:00:00Z`);

/** A known Sunday, to name weekday numbers with `Intl` in any language (0 is Sunday). */
export const weekdayDate = (weekday: number): Date => new Date(Date.UTC(2023, 0, 1 + weekday));

/** IANA zones the browser knows, for the picker; the current value is always offered. */
export function timeZoneOptions(current: string): string[] {
  let all: string[] = [];
  try {
    all =
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      ) ?? [];
  } catch {
    all = [];
  }
  const set = new Set(all);
  if (current) set.add(current);
  set.add('UTC');
  return [...set].sort();
}
