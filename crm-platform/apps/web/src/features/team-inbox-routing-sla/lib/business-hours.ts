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
}

export interface BusinessHoursDraft {
  timezone: string;
  days: Record<BusinessHoursDay, BusinessHoursDayDraft>;
}

/** What is wrong with one day, as a message key of the dialog ("required" for an empty time, "order" for a closing time not after opening). */
export type DayProblem = 'required' | 'order';
export type DayProblems = Partial<Record<BusinessHoursDay, DayProblem>>;

export function draftFrom(hours: BusinessHours): BusinessHoursDraft {
  return {
    timezone: hours.timezone,
    days: Object.fromEntries(
      BUSINESS_HOURS_DAY_KEYS.map((k) => [k, { ...hours.days[k] }]),
    ) as BusinessHoursDraft['days'],
  };
}

/** The same rules the server checks (`businessHoursDaySchema`), named so the dialog can say which part is wrong. */
export function checkDraft(draft: BusinessHoursDraft): DayProblems {
  const problems: DayProblems = {};
  for (const k of BUSINESS_HOURS_DAY_KEYS) {
    const day = draft.days[k];
    if (day.from === '' || day.to === '') {
      problems[k] = 'required';
      continue;
    }
    const parsed = businessHoursDaySchema.safeParse(day);
    if (!parsed.success) problems[k] = 'order';
  }
  return problems;
}

/**
 * The request body for a save. The time zone goes only when this person may change it (the owner); the server would ignore it for
 * anyone else, and a request that never carries it says so plainly.
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
