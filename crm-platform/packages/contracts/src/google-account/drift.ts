import { z } from 'zod';

/**
 * Calendar drift (TW-GACC-011): Google is not the source of truth for an appointment. A bounded reconcile notices when the Google event of
 * an upcoming appointment no longer matches what we last wrote to it, stores the drift here, and a person decides. Nothing about the
 * appointment changes by itself.
 *
 *  - `event_deleted`: the event was deleted or cancelled in Google (410, or status `cancelled`).
 *  - `event_missing`: Google answers 404 for the event id: it is gone, or no longer visible to the connected account.
 *  - `time_changed`: the event's start or end is not the one we wrote.
 *  - `attendees_changed`: the guests are not the one we invited (our guest removed, or another guest added).
 */
export const CALENDAR_DRIFT_REASONS = [
  'event_deleted',
  'event_missing',
  'time_changed',
  'attendees_changed',
] as const;
export const calendarDriftReasonSchema = z.enum(CALENDAR_DRIFT_REASONS);
export type CalendarDriftReason = z.infer<typeof calendarDriftReasonSchema>;

/**
 * Why an event could not be read at all (`state: 'unreadable'`): Google answered "forbidden" (`event_forbidden`) or rejected the request
 * (`event_unreadable`) for THIS event. It is not drift (nothing is known about the event), nobody is notified, and the reconcile goes on.
 */
export const CALENDAR_UNREADABLE_REASONS = ['event_forbidden', 'event_unreadable'] as const;
export const calendarUnreadableReasonSchema = z.enum(CALENDAR_UNREADABLE_REASONS);
export type CalendarUnreadableReason = z.infer<typeof calendarUnreadableReasonSchema>;

export const calendarSyncSchema = z.object({
  /**
   * `in_sync` after a look that found it matching; `drifted` while a person has not decided; `unreadable` when Google would not show this
   * one event; never looked at yet is `null`.
   */
  state: z.enum(['in_sync', 'drifted', 'unreadable']).nullable(),
  reason: z.union([calendarDriftReasonSchema, calendarUnreadableReasonSchema]).nullable(),
  detectedAt: z.string().datetime().nullable(),
  /** What Google shows when the time was moved (`time_changed`). */
  googleStartsAt: z.string().datetime().nullable(),
  googleEndsAt: z.string().datetime().nullable(),
  checkedAt: z.string().datetime().nullable(),
});
export type CalendarSync = z.infer<typeof calendarSyncSchema>;

/** What a drift action answers: the appointment is re-read by the caller; this says what was done. */
export const calendarDriftActionSchema = z.object({
  /** `pushed`: the event was written again from the appointment. `accepted`: Google's change was applied (or acknowledged). */
  done: z.enum(['pushed', 'accepted']),
  /** For `accepted`: what was applied. `cancelled` / `rescheduled` go through the usual appointment rules and customer notifications. */
  applied: z.enum(['cancelled', 'rescheduled', 'acknowledged']).nullable(),
});
export type CalendarDriftAction = z.infer<typeof calendarDriftActionSchema>;

/** The outbox event written when an appointment's Google event is first found drifted (once per appointment until it is resolved). */
export const APPOINTMENT_CALENDAR_DRIFTED = 'appointment.calendar_drifted';
