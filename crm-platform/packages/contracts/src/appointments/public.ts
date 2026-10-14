import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { appointmentStatusSchema, answersInputSchema, inviteeInputSchema } from './appointment';
import {
  bookingLocationTypeSchema,
  bookingQuestionTypeSchema,
  timeZoneSchema,
} from './booking-type';

/**
 * The customer's side (EXT-APPT-01, TW-APPT-024..026). No login: a booking page is public by design (`/v2/public/booking/<workspace
 * slug>/<type slug>`), and a booking is managed with its unguessable token (`/v2/public/booking-manage/<token>`). Nothing here returns
 * an invitee's details, an internal id, or another customer's data.
 */

const publicQuestionSchema = z.object({
  id: uuidSchema,
  label: z.string(),
  type: bookingQuestionTypeSchema,
  options: z.array(z.string()).nullable(),
  required: z.boolean(),
});

export const publicBookingTypeSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  introMessage: z.string().nullable(),
  durationMinutes: z.number().int(),
  locationType: bookingLocationTypeSchema,
  /** The address, phone or link; shown on the page, not secret. */
  locationValue: z.string().nullable(),
  color: z.string().nullable(),
  /** The zone the days are cut in. */
  timezone: z.string(),
  /** True when staff approve requests: the visitor is told it is a request. */
  approvalRequired: z.boolean(),
  /** Null for a free service. */
  price: z
    .object({ currency: z.string().nullable(), total: z.string(), dueNow: z.string() })
    .nullable(),
  questions: z.array(publicQuestionSchema),
  /**
   * The optional consent line (BL-167): the wording and version of the tick box under the form, or null when the workspace has none.
   * Booking never needs it; only a visitor who ticks it is recorded as agreeing.
   */
  consent: z
    .object({ text: z.string(), version: z.number().int().min(1), url: z.string().nullable() })
    .nullable()
    .default(null),
});
export type PublicBookingType = z.infer<typeof publicBookingTypeSchema>;

/** `GET /public/booking/:orgSlug`: the workspace's bookable services. */
export const publicBookingPageSchema = z.object({
  organization: z.object({ name: z.string(), slug: z.string() }),
  services: z.array(publicBookingTypeSchema),
});
export type PublicBookingPage = z.infer<typeof publicBookingPageSchema>;

export const publicBookInputSchema = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
    name: inviteeInputSchema.shape.name,
    email: inviteeInputSchema.shape.email,
    phone: inviteeInputSchema.shape.phone,
    /** Where the visitor is, for the confirmation's wording. */
    timezone: timeZoneSchema.nullish(),
    notes: z.string().trim().max(2000).nullish(),
    answers: answersInputSchema.optional(),
    /** The visitor ticked the consent line, which was at this version. Ignored when the page has no such line or the version is unknown. */
    consent: z.object({ given: z.boolean(), version: z.number().int().min(1) }).optional(),
  })
  .refine((v) => v.email || v.phone, {
    message: 'give an email or a phone number so we can reach you',
    path: ['email'],
  });
export type PublicBookInput = z.infer<typeof publicBookInputSchema>;

export const publicBookResponseSchema = z.object({
  status: appointmentStatusSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string(),
  /** True when the booking waits for staff approval. */
  requiresApproval: z.boolean(),
  /** Set when a deposit or payment is due to confirm it. */
  paymentDue: z.object({ currency: z.string().nullable(), amount: z.string() }).nullable(),
  /** The bearer token of the manage page; keep it private. */
  manageToken: z.string(),
  manageUrl: z.string(),
  /** The same visitor booking the same slot again gets their booking back. */
  replay: z.boolean(),
});
export type PublicBookResponse = z.infer<typeof publicBookResponseSchema>;

export const publicManageViewSchema = z.object({
  status: appointmentStatusSchema,
  organization: z.object({ name: z.string() }),
  bookingType: z
    .object({
      name: z.string(),
      durationMinutes: z.number().int(),
      locationType: bookingLocationTypeSchema,
      locationValue: z.string().nullable(),
    })
    .nullable(),
  title: z.string(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string(),
  meetUrl: z.string().nullable(),
  canCancel: z.boolean(),
  canReschedule: z.boolean(),
  /** What cancelling now would record (never charged). */
  cancelFee: z.object({ currency: z.string().nullable(), amount: z.string() }).nullable(),
});
export type PublicManageView = z.infer<typeof publicManageViewSchema>;

export const publicRescheduleInputSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
});
export type PublicRescheduleInput = z.infer<typeof publicRescheduleInputSchema>;

export const publicCancelInputSchema = z.object({
  reason: z.string().trim().max(500).nullish(),
});
export type PublicCancelInput = z.infer<typeof publicCancelInputSchema>;
