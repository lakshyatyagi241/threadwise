import {
  BUSINESS_HOURS_DAY_KEYS,
  BUSINESS_HOURS_MAX_EXTRA_WINDOWS,
  BUSINESS_HOURS_MAX_HOLIDAYS,
  businessHoursHolidaySchema,
  windowSpan,
  type BusinessHours,
  type BusinessHoursDay,
  type UpdateWorkingHoursInput,
} from '@crm/contracts';

/** One opening window as the form holds it: the time boxes are text until they are checked. */
export interface WindowDraft {
  from: string;
  to: string;
}

export interface DayDraft {
  enabled: boolean;
  /** At least one; the first is the day's main window, the rest are its extra windows. */
  windows: WindowDraft[];
}

export interface HolidayDraft {
  date: string;
  label: string;
}

export interface WorkingHoursDraft {
  days: Record<BusinessHoursDay, DayDraft>;
  holidays: HolidayDraft[];
}

export const MAX_WINDOWS = 1 + BUSINESS_HOURS_MAX_EXTRA_WINDOWS;
export const MAX_HOLIDAYS = BUSINESS_HOURS_MAX_HOLIDAYS;
export const WEEKDAYS: readonly BusinessHoursDay[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

export function draftFrom(hours: BusinessHours): WorkingHoursDraft {
  return {
    days: Object.fromEntries(
      BUSINESS_HOURS_DAY_KEYS.map((k) => {
        const d = hours.days[k];
        return [
          k,
          {
            enabled: d.enabled,
            windows: [{ from: d.from, to: d.to }, ...(d.extra ?? []).map((w) => ({ ...w }))],
          },
        ];
      }),
    ) as WorkingHoursDraft['days'],
    holidays: hours.holidays.map((h) => ({ date: h.date, label: h.label ?? '' })),
  };
}

/** A day open from midnight to the end of the day, as one window ("24:00" cannot be typed into a time box). */
export const isAllDay = (d: DayDraft): boolean =>
  d.windows.length === 1 && d.windows[0]!.from === '00:00' && d.windows[0]!.to === '24:00';

export const isOvernight = (w: WindowDraft): boolean =>
  w.from !== '' && w.to !== '' && w.to !== '24:00' && w.to < w.from;

export function setAllDay(d: DayDraft, on: boolean): DayDraft {
  return {
    ...d,
    windows: [on ? { from: '00:00', to: '24:00' } : { from: '09:00', to: '18:00' }],
  };
}

/** A new window starts two hours after the last one ends (or at 14:00) and runs two hours, within the day. */
export function addWindow(d: DayDraft): DayDraft {
  if (d.windows.length >= MAX_WINDOWS) return d;
  const last = d.windows[d.windows.length - 1]!;
  const end = last.to === '24:00' || last.to === '' ? 12 * 60 : toMinutes(last.to);
  const start = Math.min(end + 120, 20 * 60);
  return {
    ...d,
    windows: [
      ...d.windows,
      { from: fromMinutes(start), to: fromMinutes(Math.min(start + 120, 24 * 60 - 1)) },
    ],
  };
}

export function removeWindow(d: DayDraft, index: number): DayDraft {
  if (d.windows.length <= 1) return d;
  return { ...d, windows: d.windows.filter((_, i) => i !== index) };
}

/** Monday's schedule copied to Tuesday through Friday. */
export function copyMondayToWeekdays(draft: WorkingHoursDraft): WorkingHoursDraft {
  const mon = draft.days.mon;
  const days = { ...draft.days };
  for (const k of WEEKDAYS) {
    if (k !== 'mon')
      days[k] = { enabled: mon.enabled, windows: mon.windows.map((w) => ({ ...w })) };
  }
  return { ...draft, days };
}

function toMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
}
function fromMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** What is wrong with a day: an empty time, equal times, or two windows that overlap. A message key of the card. */
export type DayProblem = 'required' | 'same' | 'overlap';
export type HolidayProblem = 'date' | 'duplicate';

export interface Problems {
  days: Partial<Record<BusinessHoursDay, DayProblem>>;
  holidays: Record<number, HolidayProblem>;
}

export const hasProblems = (p: Problems): boolean =>
  Object.keys(p.days).length > 0 || Object.keys(p.holidays).length > 0;

/** The same rules the server checks (`businessHoursDaySchema`, the holiday list), named so the card can say which part is wrong. */
export function checkDraft(draft: WorkingHoursDraft): Problems {
  const problems: Problems = { days: {}, holidays: {} };
  for (const k of BUSINESS_HOURS_DAY_KEYS) {
    const { windows } = draft.days[k];
    if (windows.some((w) => w.from === '' || w.to === '')) {
      problems.days[k] = 'required';
    } else if (windows.some((w) => w.from === w.to)) {
      problems.days[k] = 'same';
    } else {
      const spans = windows.map(windowSpan).sort((a, b) => a[0] - b[0]);
      if (spans.some((s, i) => i > 0 && s[0] < spans[i - 1]![1])) problems.days[k] = 'overlap';
    }
  }
  const seen = new Set<string>();
  draft.holidays.forEach((h, i) => {
    if (!businessHoursHolidaySchema.safeParse({ date: h.date }).success)
      problems.holidays[i] = 'date';
    else if (seen.has(h.date)) problems.holidays[i] = 'duplicate';
    seen.add(h.date);
  });
  return problems;
}

/** The request body for a save: all seven days and the holiday list as the card holds it. */
export function toRequest(draft: WorkingHoursDraft): UpdateWorkingHoursInput {
  const days = Object.fromEntries(
    BUSINESS_HOURS_DAY_KEYS.map((k) => {
      const d = draft.days[k];
      const [first, ...rest] = d.windows;
      return [
        k,
        {
          enabled: d.enabled,
          from: first!.from,
          to: first!.to,
          ...(rest.length > 0 ? { extra: rest.map((w) => ({ from: w.from, to: w.to })) } : {}),
        },
      ];
    }),
  ) as UpdateWorkingHoursInput['days'];
  const holidays = draft.holidays.map((h) => {
    const label = h.label.trim();
    return label ? { date: h.date, label } : { date: h.date };
  });
  return { days, holidays };
}

export function addHoliday(
  draft: WorkingHoursDraft,
  date: string,
  label: string,
): WorkingHoursDraft {
  if (draft.holidays.length >= MAX_HOLIDAYS) return draft;
  const holidays = [...draft.holidays, { date, label }].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  return { ...draft, holidays };
}
