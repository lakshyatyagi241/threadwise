import { z } from 'zod';
import {
  availabilityListSchema,
  dateOverrideSchema,
  localDateSchema,
  timeZoneSchema,
} from './booking-type';

/**
 * Slots (TW-APPT-016..019). A day is a calendar date in the booking type's zone; a slot is an instant range. Everything is computed
 * now from the live data: nothing is cached, so a booking made a second ago is already gone from the list.
 */

export const SLOTS_MAX_DAYS = 62;
export const SLOTS_DEFAULT_DAYS = 14;

export const slotsQuerySchema = z.object({
  /** First local date, `YYYY-MM-DD` in the type's zone. Default: today. */
  from: localDateSchema.optional(),
  /** Last local date, inclusive. Default: `from` + 13 days; at most 62 days after `from`. */
  to: localDateSchema.optional(),
});
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

export const slotSchema = z.object({
  /** ISO instants (UTC). */
  start: z.string().datetime(),
  end: z.string().datetime(),
  /** Seats left in this slot (1 for a one-to-one type). */
  remaining: z.number().int(),
});
export type Slot = z.infer<typeof slotSchema>;

export const slotDaySchema = z.object({
  /** The local date in the type's zone. */
  date: z.string(),
  slots: z.array(slotSchema),
});
export type SlotDay = z.infer<typeof slotDaySchema>;

export const slotsResponseSchema = z.object({
  /** The zone `days` are cut in (the type's). */
  timezone: z.string(),
  durationMinutes: z.number().int(),
  /** Only days that have at least one open slot. */
  days: z.array(slotDaySchema),
});
export type SlotsResponse = z.infer<typeof slotsResponseSchema>;

/** The wizard's stateless preview: an unsaved draft in, the slots the engine would offer out (bookings and reservations are not counted). */
export const previewSlotsSchema = z.object({
  draft: z.object({
    timezone: timeZoneSchema.nullish(),
    durationMinutes: z.number().int().min(5).max(1440),
    incrementMinutes: z.number().int().min(5).max(1440).optional(),
    bufferBeforeMinutes: z.number().int().min(0).max(1440).default(0),
    bufferAfterMinutes: z.number().int().min(0).max(1440).default(0),
    minNoticeMinutes: z.number().int().min(0).max(525_600).default(0),
    maxAdvanceDays: z.number().int().min(1).max(365).default(30),
    maxPerDay: z.number().int().min(1).max(500).nullish(),
    capacity: z.number().int().min(1).max(500).default(1),
    availability: availabilityListSchema.default([]),
    overrides: z.array(dateOverrideSchema).max(400).default([]),
  }),
  /** Days to preview from today (1-14). */
  days: z.number().int().min(1).max(14).default(7),
});
export type PreviewSlotsInput = z.infer<typeof previewSlotsSchema>;

export const previewSlotsResponseSchema = slotsResponseSchema.extend({
  count: z.number().int(),
});
export type PreviewSlotsResponse = z.infer<typeof previewSlotsResponseSchema>;
