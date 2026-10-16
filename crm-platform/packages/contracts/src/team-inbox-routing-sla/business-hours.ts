import { z } from 'zod';

/**
 * Business hours (TW-TIB2-001): the workspace's weekly schedule and its time zone. The routing condition "outside business hours", the
 * SLA clock (when the policy respects business hours) and the flows' out-of-hours trigger read the same schedule.
 *
 * A day is open from `from` up to, not including, `to`, both "HH:MM" in the workspace time zone. `to` must be after `from`, so a window
 * never crosses midnight (Reference's rule). Every one of the seven days carries a window, enabled or not, as in Reference.
 */

export const BUSINESS_HOURS_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type BusinessHoursDay = (typeof BUSINESS_HOURS_DAY_KEYS)[number];

function isIanaZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time such as 09:00.');

export const businessHoursDaySchema = z
  .object({
    enabled: z.boolean(),
    from: clock,
    to: clock,
  })
  .refine((d) => d.to > d.from, {
    message: 'The closing time must be after the opening time.',
    path: ['to'],
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

/** `GET /inbox/routing/business-hours`. The schedule comes back with the Reference default (Mon-Fri 09:00-18:00) until one is saved. */
export const businessHoursSchema = z.object({
  timezone: z.string().min(1).max(64),
  /** Whether this caller may change the time zone. Only the workspace owner may (anyone else's zone is ignored on save). */
  canEditTimezone: z.boolean(),
  days: businessHoursDaysSchema,
});
export type BusinessHours = z.infer<typeof businessHoursSchema>;

/**
 * `PUT /inbox/routing/business-hours`. `timezone` is optional and only the owner's value is kept; the days are always saved.
 * Other keys stored with the schedule (outside-hours reply, anti-spam; not in this slice yet) are kept as they are.
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
  })
  .strict();
export type UpdateBusinessHoursInput = z.infer<typeof updateBusinessHoursSchema>;
