import type { FollowUpSettingsValues } from '@crm/contracts';
import { addDays, calendarDay } from '../../../common/workspace-calendar';

/**
 * Pure rules of automatic follow-ups (docs/specs/lead-followup-settings.md, section 2.3): where a contact's next follow-up stands against
 * the clock, which settings apply to that state, and the date and alert time the rule sets. No database, so a unit test pins them,
 * daylight saving and month ends included.
 */

/** Where a contact stands: no follow-up, a follow-up without a date, or a dated one against now and the end of the workspace's today. */
export type FollowUpState = 'none' | 'someday' | 'overdue' | 'today' | 'upcoming';

/**
 * The state of an open follow-up. `due` is `undefined` when the contact has no open follow-up, `null` when it has one without a date.
 * Same four-way split as the task list's buckets (`bucketOf`): overdue is before now, today is the rest of the workspace's day.
 */
export function followUpState(
  due: Date | null | undefined,
  now: Date,
  dayEnd: Date,
): FollowUpState {
  if (due === undefined) return 'none';
  if (due === null) return 'someday';
  if (due.getTime() < now.getTime()) return 'overdue';
  if (due.getTime() < dayEnd.getTime()) return 'today';
  return 'upcoming';
}

/** Does the workspace want the follow-up updated when it is in this state? A follow-up without a date counts as having none. */
export function updatesWhen(s: FollowUpSettingsValues, state: FollowUpState): boolean {
  switch (state) {
    case 'none':
    case 'someday':
      return s.updateWhen.none;
    case 'overdue':
      return s.updateWhen.overdue;
    case 'today':
      return s.updateWhen.today;
    case 'upcoming':
      return s.updateWhen.future;
  }
}

/** The wall clock of an instant in a zone, as minutes ahead of UTC (positive east). */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The instant at which the clock of `timeZone` reads `day` (`YYYY-MM-DD`) and `time` (`HH:mm`). Daylight saving is the zone's own: a time
 * that does not exist (the hour skipped in spring) lands on the same minute after the gap; one that happens twice takes the first.
 * The two offsets in force a day before and a day after give the only possible candidates; the one whose own clock reads the wanted time
 * is the answer.
 */
export function zonedInstant(day: string, time: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const DAY = 86_400_000;
  const before = offsetMinutes(new Date(wall - DAY), timeZone);
  const after = offsetMinutes(new Date(wall + DAY), timeZone);
  const candidates = [...new Set([wall - before * 60_000, wall - after * 60_000])].sort(
    (a, b) => a - b,
  );
  const valid = candidates.filter(
    (c) => c + offsetMinutes(new Date(c), timeZone) * 60_000 === wall,
  );
  // Both valid: the time happens twice, the first wins. None valid: the time was skipped, the later reading is the minute after the gap.
  return new Date(valid.length > 0 ? valid[0]! : candidates[candidates.length - 1]!);
}

/** The same day of the next calendar month, or the month's last day when it has no such day (31 January -> 28 or 29 February). */
export function addMonth(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** What the rule sets: a dated follow-up, a follow-up without a date (someday), or none (the open one is completed). */
export type PlannedFollowUp = { kind: 'date'; at: Date } | { kind: 'someday' } | { kind: 'none' };

/** The follow-up the workspace's default date and alert time give for a touch at `now`. */
export function plannedFollowUp(
  s: Pick<FollowUpSettingsValues, 'defaultDate' | 'defaultTime'>,
  now: Date,
  timeZone: string,
): PlannedFollowUp {
  const d = s.defaultDate;
  if (d.kind === 'someday') return { kind: 'someday' };
  if (d.kind === 'none') return { kind: 'none' };
  const today = calendarDay(now, timeZone);
  const day = d.kind === 'month' ? addMonth(today) : addDays(today, d.days);
  return { kind: 'date', at: zonedInstant(day, s.defaultTime, timeZone) };
}

/** The first instant of the day after `now`'s, in the zone: where "today" ends. */
export function dayEndOf(now: Date, timeZone: string): Date {
  return zonedInstant(addDays(calendarDay(now, timeZone), 1), '00:00', timeZone);
}

/** The alert time of a follow-up snoozed by hand: the preset's day at the workspace's default alert time. */
export function snoozedTo(
  preset: 'day' | 'three_days' | 'week',
  defaultTime: string,
  now: Date,
  timeZone: string,
): Date {
  const n = preset === 'day' ? 1 : preset === 'three_days' ? 3 : 7;
  return zonedInstant(addDays(calendarDay(now, timeZone), n), defaultTime, timeZone);
}
