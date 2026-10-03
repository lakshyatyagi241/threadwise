import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { queryBoolean, queryList } from '../contacts-attributes-tags/query-helpers';
import { dealValueSchema } from '../deals-pipelines/money';
import {
  bookingLocationTypeSchema,
  bookingQuestionTypeSchema,
  timeZoneSchema,
} from './booking-type';

/**
 * Appointments (WD-APPT-002..004, 021, 039; EXT-APPT-02..07). One row per booking. The status is a guarded machine:
 *
 *   pending -> confirmed | declined | cancelled      (confirmed -> cancelled | completed | no_show)
 *
 * `cancelled`, `declined`, `completed` and `no_show` are final. The slot is held by `pending` and `confirmed` only.
 */

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'cancelled',
  'declined',
  'completed',
  'no_show',
] as const;
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

/** The statuses that hold a slot. */
export const ACTIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed'] as const;

export const APPOINTMENT_PAYMENT_STATUSES = [
  'none',
  'pending',
  'paid',
  'partial',
  'refunded',
] as const;
export const appointmentPaymentStatusSchema = z.enum(APPOINTMENT_PAYMENT_STATUSES);
export type AppointmentPaymentStatus = z.infer<typeof appointmentPaymentStatusSchema>;

/** Where a booking came from: a chat flow, the public page, a staff member, or the API. */
export const APPOINTMENT_SOURCES = ['chat', 'link', 'manual', 'api'] as const;
export const appointmentSourceSchema = z.enum(APPOINTMENT_SOURCES);
export type AppointmentSource = z.infer<typeof appointmentSourceSchema>;

export const APPOINTMENT_CANCELLERS = ['staff', 'invitee', 'system'] as const;
export const appointmentCancellerSchema = z.enum(APPOINTMENT_CANCELLERS);

export const APPOINTMENT_NOTES_MAX = 5000;

export const inviteeSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type Invitee = z.infer<typeof inviteeSchema>;

/** The invitee as typed: a name, and at least a phone or an email so there is somebody to tell. */
export const inviteeInputSchema = z.object({
  name: z.string().trim().min(1).max(191),
  email: z.string().trim().toLowerCase().email().max(191).nullish(),
  /** Any phone format; it is normalised to E.164 (a number it cannot read is 422). */
  phone: z.string().trim().min(5).max(32).nullish(),
});
export type InviteeInput = z.infer<typeof inviteeInputSchema>;

/** Answers are sent as `{ <question id>: "value" }`. */
export const answersInputSchema = z.record(uuidSchema, z.string().trim().max(2000));
export type AnswersInput = z.infer<typeof answersInputSchema>;

export const appointmentAnswerSchema = z.object({
  questionId: uuidSchema.nullable(),
  label: z.string(),
  type: bookingQuestionTypeSchema,
  value: z.string(),
});
export type AppointmentAnswer = z.infer<typeof appointmentAnswerSchema>;

export const appointmentPaymentSchema = z.object({
  status: appointmentPaymentStatusSchema,
  currency: z.string().nullable(),
  /** The price at the time of booking (fee + tax). */
  total: z.string(),
  /** What was due to book (deposit or full). */
  dueNow: z.string(),
  paid: z.string(),
  /** A cancel or no-show fee recorded against the booking (never charged here). */
  feeRecorded: z.string(),
  /** When an unpaid pending booking stops holding its slot. */
  holdExpiresAt: z.string().datetime().nullable(),
});
export type AppointmentPayment = z.infer<typeof appointmentPaymentSchema>;

export const appointmentResponseSchema = z.object({
  id: uuidSchema,
  status: appointmentStatusSchema,
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  /** The booking type's zone at booking time (the one staff read the time in). */
  timezone: z.string(),
  /** The zone the invitee booked from, when they said. */
  inviteeTimezone: z.string().nullable(),
  location: z.string().nullable(),
  meetUrl: z.string().nullable(),
  bookingType: z
    .object({
      id: uuidSchema,
      name: z.string(),
      color: z.string().nullable(),
      durationMinutes: z.number().int(),
      locationType: bookingLocationTypeSchema,
    })
    .nullable(),
  seat: z.number().int(),
  invitee: inviteeSchema,
  contact: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
  host: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  source: appointmentSourceSchema,
  answers: z.array(appointmentAnswerSchema),
  /** Staff notes; encrypted at rest. */
  notes: z.string().nullable(),
  payment: appointmentPaymentSchema,
  /** Confirmed, ended and nobody marked it completed or no-show. */
  needsReview: z.boolean(),
  checkedInAt: z.string().datetime().nullable(),
  statusChangedAt: z.string().datetime(),
  cancelledAt: z.string().datetime().nullable(),
  cancelledBy: appointmentCancellerSchema.nullable(),
  cancelReason: z.string().nullable(),
  calendar: z.object({
    eventId: z.string().nullable(),
    calendarId: z.string().nullable(),
  }),
  /** The customer's manage link (reschedule or cancel); staff can copy it. */
  manageUrl: z.string().nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AppointmentResponse = z.infer<typeof appointmentResponseSchema>;

export const appointmentPageResponseSchema = z.object({
  data: z.array(appointmentResponseSchema),
  page: pageInfoSchema,
});
export type AppointmentPageResponse = z.infer<typeof appointmentPageResponseSchema>;

// --- requests ---------------------------------------------------------------------------------------------------------------

const startsAt = z.string().datetime({ offset: true });

/** Staff book for a customer. The result is `confirmed` whatever the type's approval rule (staff are the approval). */
export const createAppointmentSchema = z
  .object({
    bookingTypeId: uuidSchema,
    startsAt,
    /** An existing contact; otherwise the invitee is matched or created by phone and email. */
    contactId: uuidSchema.nullish(),
    invitee: inviteeInputSchema.optional(),
    /** The zone the customer is in (labels in messages). */
    inviteeTimezone: timeZoneSchema.nullish(),
    notes: z.string().trim().max(APPOINTMENT_NOTES_MAX).nullish(),
    answers: answersInputSchema.optional(),
    /** The member who hosts it; default the type's host. */
    hostId: uuidSchema.nullish(),
    /** Book a time the engine would not offer (outside the hours, inside the notice). A taken seat is never ignored. */
    ignoreAvailability: z.boolean().default(false),
    /** Tell the customer through the message port. */
    notify: z.boolean().default(true),
  })
  .refine((v) => v.contactId || v.invitee, {
    message: 'send a contactId or an invitee',
    path: ['invitee'],
  });
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

/** Absent keeps, `null` clears where a field can be empty. The time moves through `reschedule`, the status through the actions. */
export const updateAppointmentSchema = z.object({
  title: z.string().trim().min(1).max(191).optional(),
  description: z.string().trim().max(5000).nullish(),
  location: z.string().trim().max(1000).nullish(),
  notes: z.string().trim().max(APPOINTMENT_NOTES_MAX).nullish(),
  hostId: uuidSchema.nullish(),
  contactId: uuidSchema.nullish(),
  invitee: inviteeInputSchema.partial().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

const optionalVersion = z.number().int().positive().optional();

export const rescheduleAppointmentSchema = z.object({
  startsAt,
  ignoreAvailability: z.boolean().default(false),
  notify: z.boolean().default(true),
  rowVersion: optionalVersion,
});
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const cancelAppointmentSchema = z.object({
  reason: z.string().trim().max(500).nullish(),
  notify: z.boolean().default(true),
  rowVersion: optionalVersion,
});
export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

/** Confirm, decline, complete, no-show and check-in: an optional reason (decline) and an optional version. */
export const appointmentActionSchema = z.object({
  reason: z.string().trim().max(500).nullish(),
  notify: z.boolean().default(true),
  rowVersion: optionalVersion,
});
export type AppointmentActionInput = z.infer<typeof appointmentActionSchema>;

/** A payment received outside the app (cash, transfer) or by a gateway adapter: major units in the booking's currency. */
export const recordAppointmentPaymentSchema = z.object({
  amount: dealValueSchema,
  method: z.string().trim().max(60).nullish(),
  reference: z.string().trim().max(191).nullish(),
});
export type RecordAppointmentPaymentInput = z.infer<typeof recordAppointmentPaymentSchema>;

export const APPOINTMENT_SCOPES = ['upcoming', 'past', 'all'] as const;
export const appointmentScopeSchema = z.enum(APPOINTMENT_SCOPES);
export type AppointmentScopeFilter = z.infer<typeof appointmentScopeSchema>;

const filterShape = {
  /** Title and invitee name, email or phone. */
  q: z.string().trim().min(1).max(100).optional(),
  bookingTypeId: uuidSchema.optional(),
  contactId: uuidSchema.optional(),
  hostId: uuidSchema.optional(),
  /** Hosted by the caller (the "my appointments" tab). */
  mine: queryBoolean().optional(),
  /** Starts at or after / before these instants. */
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  needsReview: queryBoolean().optional(),
};

export const listAppointmentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
  /** `upcoming` (not started, pending or confirmed; soonest first), `past` (started; latest first), `all`. */
  scope: appointmentScopeSchema.default('upcoming'),
  status: queryList(appointmentStatusSchema).optional(),
  /** `asc` or `desc` by start; the default follows the scope. */
  order: z.enum(['asc', 'desc']).optional(),
  ...filterShape,
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

export const appointmentCountsQuerySchema = z.object(filterShape);
export type AppointmentCountsQuery = z.infer<typeof appointmentCountsQuerySchema>;

export const appointmentCountsResponseSchema = z.object({
  pending: z.number().int(),
  confirmed: z.number().int(),
  cancelled: z.number().int(),
  declined: z.number().int(),
  completed: z.number().int(),
  noShow: z.number().int(),
  total: z.number().int(),
  /** Pending or confirmed and not started yet (the "Upcoming" tab). */
  upcoming: z.number().int(),
  /** Started already, any status (the "Past" tab). */
  past: z.number().int(),
  needsReview: z.number().int(),
  /** The caller's own upcoming bookings. */
  mine: z.object({ upcoming: z.number().int() }),
});
export type AppointmentCountsResponse = z.infer<typeof appointmentCountsResponseSchema>;

export const appointmentManageLinkSchema = z.object({
  manageUrl: z.string(),
});
export type AppointmentManageLink = z.infer<typeof appointmentManageLinkSchema>;
