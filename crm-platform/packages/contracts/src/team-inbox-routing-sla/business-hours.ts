import { z } from 'zod';

/**
 * Business hours (TW-TIB2-001, extended by the Settings "Working hours" editor): the workspace's weekly schedule, its holidays and its
 * time zone. The routing condition "outside business hours", the SLA clock (when the policy respects business hours), the flows'
 * out-of-hours trigger and the lead first-reply hold read the same schedule.
 *
 * A day is open from `from` up to, not including, `to`, both "HH:MM" in the workspace time zone. `to` may be "24:00" (end of the day).
 * A `to` before `from` is an overnight window: open from `from` until midnight and until `to` the next morning. `from` equal to `to` is
 * not a window. A day may carry up to two `extra` windows after the first (a lunch break is two windows); they may not overlap. Every one
 * of the seven days carries a window, enabled or not, as in Reference. `holidays` are dates closed all day.
 */

export const BUSINESS_HOURS_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type BusinessHoursDay = (typeof BUSINESS_HOURS_DAY_KEYS)[number];

/** Windows a day may have besides its first one. */
export const BUSINESS_HOURS_MAX_EXTRA_WINDOWS = 2;
export const BUSINESS_HOURS_MAX_HOLIDAYS = 100;

/** Whether the text names a time zone the runtime knows (`Europe/London`). */
export function isIanaZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time such as 09:00.');
const closingClock = z
  .string()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Use a time such as 18:00, or 24:00.');

const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** One window as the minutes of the day it covers (an overnight window covers up to the end of its own day here). */
export function windowSpan(w: { from: string; to: string }): [number, number] {
  const from = minutesOf(w.from);
  const to = minutesOf(w.to);
  return [from, to <= from ? 24 * 60 : to];
}

export const businessHoursWindowSchema = z
  .object({ from: clock, to: closingClock })
  .refine((w) => w.to !== w.from, {
    message: 'The closing time must differ from the opening time.',
    path: ['to'],
  });
export type BusinessHoursWindow = z.infer<typeof businessHoursWindowSchema>;

export const businessHoursDaySchema = z
  .object({
    enabled: z.boolean(),
    from: clock,
    to: closingClock,
    extra: z.array(businessHoursWindowSchema).max(BUSINESS_HOURS_MAX_EXTRA_WINDOWS).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.to === d.from) {
      ctx.addIssue({
        code: 'custom',
        message: 'The closing time must differ from the opening time.',
        path: ['to'],
      });
      return;
    }
    const spans = [windowSpan(d), ...(d.extra ?? []).map(windowSpan)].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) {
      if (spans[i]![0] < spans[i - 1]![1]) {
        ctx.addIssue({
          code: 'custom',
          message: 'Windows of one day must not overlap.',
          path: ['extra'],
        });
        return;
      }
    }
  });
export type BusinessHoursDayInput = z.infer<typeof businessHoursDaySchema>;

export const businessHoursDaysSchema = z.object({
  mon: businessHoursDaySchema,
  tue: businessHoursDaySchema,
  wed: businessHoursDaySchema,
  thu: businessHoursDaySchema,
  fri: businessHoursDaySchema,
  sat: businessHoursDaySchema,
  sun: businessHoursDaySchema,
});
export type BusinessHoursDays = z.infer<typeof businessHoursDaysSchema>;

/** A date the workspace is closed all day, "YYYY-MM-DD" in the workspace time zone. */
export const businessHoursHolidaySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-25.')
    .refine((s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, 'Not a real date.'),
  label: z.string().trim().max(80).optional(),
});
export type BusinessHoursHoliday = z.infer<typeof businessHoursHolidaySchema>;

export const businessHoursHolidaysSchema = z
  .array(businessHoursHolidaySchema)
  .max(BUSINESS_HOURS_MAX_HOLIDAYS)
  .refine((list) => new Set(list.map((h) => h.date)).size === list.length, {
    message: 'Each date may be listed once.',
  });

/** `GET /inbox/routing/business-hours` and `GET /shell/workspace/working-hours`. The schedule comes back with the Reference default (Mon-Fri 09:00-18:00) until one is saved. */
export const businessHoursSchema = z.object({
  timezone: z.string().min(1).max(64),
  /** Whether this caller may change the time zone. Only the workspace owner may (anyone else's zone is ignored on save). */
  canEditTimezone: z.boolean(),
  days: businessHoursDaysSchema,
  holidays: z.array(businessHoursHolidaySchema),
});
export type BusinessHours = z.infer<typeof businessHoursSchema>;

/**
 * `PUT /inbox/routing/business-hours` and `PUT /shell/workspace/working-hours`. `timezone` is optional and only the owner's value is
 * kept; the days are always saved. `holidays` is optional: left out, the saved holidays stay as they are (the Auto-assignment dialog
 * does not edit them). Other keys stored with the schedule (outside-hours reply, anti-spam; not in this slice yet) are kept as they are.
 */
export const updateBusinessHoursSchema = z
  .object({
    timezone: z
      .string()
      .min(1)
      .max(64)
      .refine(isIanaZone, { message: 'Not an IANA timezone.' })
      .optional(),
    days: businessHoursDaysSchema,
    holidays: businessHoursHolidaysSchema.optional(),
  })
  .strict();
export type UpdateBusinessHoursInput = z.infer<typeof updateBusinessHoursSchema>;

/**
 * `PUT /shell/workspace/working-hours` (Settings > General). The time zone is the General tab's own field, so it is not part of this
 * body; `holidays` is optional and left out keeps the saved ones.
 */
export const updateWorkingHoursSchema = updateBusinessHoursSchema.omit({ timezone: true });
export type UpdateWorkingHoursInput = z.infer<typeof updateWorkingHoursSchema>;
