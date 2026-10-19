import {
  BUSINESS_HOURS_DAY_KEYS,
  businessHoursDaySchema,
  type BusinessHours,
  type BusinessHoursDay,
  type UpdateBusinessHoursInput,
} from '@crm/contracts';

/** One day as the form holds it: the time boxes are text until they are checked. */
export interface BusinessHoursDayDraft {
  enabled: boolean;
  from: string;
  to: string;
  /** Breaks and second windows are set on the web; they are carried through a save untouched. */
  extra: BusinessHours['days'][BusinessHoursDay]['extra'];
}

export interface BusinessHoursDraft {
  timezone: string;
  days: Record<BusinessHoursDay, BusinessHoursDayDraft>;
}

/**
 * What is wrong with one day, as a message key of the screen: `required` for an empty time, `format` for a time that is not HH:MM,
 * `same` for equal times. A closing time before the opening one is an overnight window, not a mistake.
 */
export type DayProblem = 'required' | 'format' | 'same';
export type DayProblems = Partial<Record<BusinessHoursDay, DayProblem>>;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const CLOSING = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export function draftFrom(hours: BusinessHours): BusinessHoursDraft {
  return {
    timezone: hours.timezone,
    days: Object.fromEntries(
      BUSINESS_HOURS_DAY_KEYS.map((k) => [k, { ...hours.days[k] }]),
    ) as BusinessHoursDraft['days'],
  };
}

/** The same rules the server checks (`businessHoursDaySchema`), named so the screen can say which part is wrong. */
export function checkDraft(draft: BusinessHoursDraft): DayProblems {
  const problems: DayProblems = {};
  for (const k of BUSINESS_HOURS_DAY_KEYS) {
    const day = draft.days[k];
    if (day.from.trim() === '' || day.to.trim() === '') problems[k] = 'required';
    else if (!CLOCK.test(day.from) || !CLOSING.test(day.to)) problems[k] = 'format';
    else if (!businessHoursDaySchema.safeParse(day).success) problems[k] = 'same';
  }
  return problems;
}

/**
 * The request body for a save. The time zone goes only when this person may change it (the owner); the server would ignore it for
 * anyone else, and a request that never carries it says so plainly. Holidays are left out: the server keeps the saved ones.
 */
export function toUpdateInput(
  draft: BusinessHoursDraft,
  canEditTimezone: boolean,
): UpdateBusinessHoursInput {
  const days = Object.fromEntries(
    BUSINESS_HOURS_DAY_KEYS.map((k) => [k, { ...draft.days[k] }]),
  ) as UpdateBusinessHoursInput['days'];
  return canEditTimezone ? { timezone: draft.timezone, days } : { days };
}

/**
 * Turns what is typed into HH:MM as it is typed: digits only, a colon after the hour ("0900" and "9" become "09:00" and "9"). Backspacing
 * over the colon works because the colon is only added once a third digit exists.
 */
export function maskTime(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
