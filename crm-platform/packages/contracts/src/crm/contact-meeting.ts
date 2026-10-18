import { z } from 'zod';
import { appointmentStatusSchema } from '../appointments/appointment';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/** Where a meeting row came from: typed in on the contact, or mirrored from a booking (an appointment). */
export const CONTACT_MEETING_SOURCES = ['manual', 'booking'] as const;
export const contactMeetingSourceSchema = z.enum(CONTACT_MEETING_SOURCES);
export type ContactMeetingSource = z.infer<typeof contactMeetingSourceSchema>;

/**
 * A meeting logged against a contact — the detail page's Meetings sub-tab.
 *
 * The booking fields are additive and optional: a row typed in by a person is `source: 'manual'` and has none of them. A row mirrored
 * from an appointment (`source: 'booking'`) carries the appointment's id and its CURRENT status (read from the appointment, never
 * stored on the meeting), and is read-only here: it is changed on the appointment.
 */
export const contactMeetingResponseSchema = z.object({
  id: uuidSchema,
  contactId: uuidSchema,
  title: z.string(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  /** A place. A web address to join the call is `joinUrl` (an older row may still hold a link here). */
  location: z.string().nullable(),
  createdBy: uuidSchema.nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  source: contactMeetingSourceSchema.optional(),
  /** The appointment this row mirrors; null when typed in, or when the appointment was deleted. */
  appointmentId: uuidSchema.nullable().optional(),
  /** The appointment's status (pending, confirmed, cancelled, declined, completed, no_show); null for a typed-in meeting. */
  status: appointmentStatusSchema.nullable().optional(),
  /** The web address that joins the call (BL-245): a calendar-made Meet or Teams link on a booking. */
  joinUrl: z.string().nullable().optional(),
  /** Whether the caller may change the booking itself (`record.appointments.update` for this appointment). False on typed-in rows. */
  canManageBooking: z.boolean().optional(),
});
export type ContactMeetingResponse = z.infer<typeof contactMeetingResponseSchema>;

export const createContactMeetingSchema = z.object({
  title: z.string().min(1).max(255),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  location: z.string().max(255).optional(),
});
export type CreateContactMeetingInput = z.infer<typeof createContactMeetingSchema>;

export const updateContactMeetingSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
  location: z.string().max(255).nullish(),
  rowVersion: z.number().int().positive(),
});
export type UpdateContactMeetingInput = z.infer<typeof updateContactMeetingSchema>;

/**
 * `upcoming`: still to come (a booking that is cancelled or declined is not), soonest first. `past`: already over or closed, latest
 * first. `all`: every row, latest start first. Left out, the list keeps its original order (most recently logged first) and no filter.
 */
export const CONTACT_MEETING_WINDOWS = ['upcoming', 'past', 'all'] as const;
export const contactMeetingWindowSchema = z.enum(CONTACT_MEETING_WINDOWS);
export type ContactMeetingWindow = z.infer<typeof contactMeetingWindowSchema>;

export const listContactMeetingsQuerySchema = paginationQuerySchema.extend({
  when: contactMeetingWindowSchema.optional(),
});
export type ListContactMeetingsQuery = z.infer<typeof listContactMeetingsQuerySchema>;
