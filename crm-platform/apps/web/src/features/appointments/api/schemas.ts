import { z } from 'zod';

/**
 * Wire shapes of the appointments API, as this feature reads them. They follow Reference's data model (appointments, booking
 * types and their children, workspace booking settings, the public booking and manage links) in our conventions: uuid ids,
 * ISO 8601 instants, camelCase, `{ data, page }` lists. While `@crm/contracts` has no appointments package this file is the
 * single place that knows the shapes; when it lands the schemas here become re-exports and nothing else moves.
 */

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'cancelled',
  'declined',
  'completed',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const LOCATION_TYPES = ['address', 'virtual', 'phone', 'whatsapp'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const QUESTION_TYPES = [
  'text',
  'textarea',
  'select',
  'number',
  'email',
  'phone',
  'date',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const DEPOSIT_MODES = ['none', 'partial', 'full'] as const;
export type DepositMode = (typeof DEPOSIT_MODES)[number];

export const TEMPLATE_EVENTS = ['confirmation', 'reminder', 'cancellation', 'reschedule'] as const;
export type TemplateEvent = (typeof TEMPLATE_EVENTS)[number];

export const PAYMENT_STATUSES = ['none', 'pending', 'paid', 'partial', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Where a booking came from: a flow's "Book appointment" node, the public booking page, or staff. */
export const BOOKING_SOURCES = ['chat', 'link', 'manual', 'api'] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

const instant = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'not an ISO 8601 instant');
const nullableText = z.string().nullable();

export const pageSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  limit: z.number().int(),
});

export const answerSchema = z.object({
  label: z.string(),
  answer: z.string(),
  questionId: z.string().optional(),
});
export type Answer = z.infer<typeof answerSchema>;

export const appointmentSchema = z.object({
  id: z.string(),
  rowVersion: z.number().int().optional(),
  status: z.enum(APPOINTMENT_STATUSES),
  title: z.string(),
  startsAt: instant,
  endsAt: instant,
  /** The zone the booking type runs in. */
  timezone: z.string(),
  /** The zone the customer booked from, when they told us. */
  inviteeTimezone: nullableText,
  bookingType: z
    .object({
      id: z.string(),
      name: z.string(),
      color: nullableText,
      durationMinutes: z.number().int(),
    })
    .nullable(),
  contact: z
    .object({ id: z.string(), name: nullableText, phone: nullableText, email: nullableText })
    .nullable(),
  customer: z.object({ name: nullableText, phone: nullableText, email: nullableText }),
  location: nullableText,
  meetUrl: nullableText,
  answers: z.array(answerSchema),
  notes: nullableText,
  source: z.string(),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  depositPaidMinor: z.number().int(),
  currency: nullableText,
  /** The public manage page of this booking, when it has one (bookings made through a flow or the public page do). */
  manageUrl: nullableText,
  checkedInAt: instant.nullable(),
  /** Confirmed, over, and nobody marked it completed or no-show. */
  needsReview: z.boolean().optional(),
  host: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  cancelledBy: z.enum(['staff', 'invitee', 'system']).nullable().optional(),
  cancelReason: nullableText.optional(),
  cancelledAt: instant.nullable().optional(),
  createdAt: instant,
  updatedAt: instant,
});
export type Appointment = z.infer<typeof appointmentSchema>;

export const appointmentPageSchema = z.object({
  data: z.array(appointmentSchema),
  page: pageSchema,
});

export const appointmentCountsSchema = z.object({
  upcoming: z.number().int(),
  past: z.number().int(),
  needsReview: z.number().int().optional(),
});
export type AppointmentCounts = z.infer<typeof appointmentCountsSchema>;

// ---- booking types -------------------------------------------------------------------------------------------------

export const availabilityRuleSchema = z.object({
  /** 0 = Sunday ... 6 = Saturday (Reference's numbering). */
  weekday: z.number().int().min(0).max(6),
  /** 24-hour "HH:MM". */
  from: z.string(),
  to: z.string(),
});

export const availabilityOverrideSchema = z.object({
  /** `YYYY-MM-DD` in the booking type's zone. */
  date: z.string(),
  closed: z.boolean(),
  from: nullableText,
  to: nullableText,
  reason: nullableText,
});

export const bookingQuestionSchema = z.object({
  /** Present on a saved question; the visitor's answers are keyed by it. */
  id: z.string().optional(),
  label: z.string(),
  type: z.enum(QUESTION_TYPES),
  options: z.array(z.string()),
  required: z.boolean(),
  /** A contact field the answer fills when the contact has none ("email", "name", "mobile"). */
  mapToContactField: nullableText,
});
export type BookingQuestion = z.infer<typeof bookingQuestionSchema>;

export const bookingTemplateSchema = z.object({
  event: z.enum(TEMPLATE_EVENTS),
  /** `whatsapp` unless the API says otherwise; sent back as it came. */
  channel: z.string().optional(),
  waTemplateId: nullableText,
  plainBody: nullableText,
});

export const bookingReminderSchema = z.object({
  offsetMinutes: z.number().int(),
  label: nullableText,
});

export const bookingPriceSchema = z.object({
  currency: z.string(),
  feeMinor: z.number().int(),
  taxPct: z.number(),
  depositMode: z.enum(DEPOSIT_MODES),
  depositValueMinor: z.number().int(),
  gatewaySlug: nullableText,
  autoSendLink: z.boolean(),
  cancelFeeMinor: z.number().int(),
  noShowFeeMinor: z.number().int(),
  cancelWindowMinutes: z.number().int(),
});

export const bookingIntegrationSchema = z.object({
  calendarId: nullableText,
  createMeet: z.boolean(),
  spreadsheetId: nullableText,
  sheetRange: nullableText,
});

export const bookingTypeSchema = z.object({
  id: z.string(),
  rowVersion: z.number().int().optional(),
  name: z.string(),
  /** The path part of the public link. */
  slug: z.string(),
  description: nullableText,
  locationType: z.enum(LOCATION_TYPES),
  locationValue: nullableText,
  color: nullableText,
  durationMinutes: z.number().int(),
  incrementMinutes: z.number().int(),
  bufferBeforeMinutes: z.number().int(),
  bufferAfterMinutes: z.number().int(),
  minNoticeMinutes: z.number().int(),
  maxAdvanceDays: z.number().int(),
  maxPerDay: z.number().int().nullable(),
  capacity: z.number().int(),
  /** When true a booking waits as "pending" until staff confirm it. */
  requiresApproval: z.boolean(),
  timezone: nullableText,
  introMessage: nullableText,
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  price: bookingPriceSchema,
  integration: bookingIntegrationSchema,
  availability: z.array(availabilityRuleSchema),
  overrides: z.array(availabilityOverrideSchema),
  templates: z.array(bookingTemplateSchema),
  reminders: z.array(bookingReminderSchema),
  questions: z.array(bookingQuestionSchema),
  appointmentsCount: z.number().int(),
  /** The page visitors book on; null while the type is paused or the workspace has no public booking. */
  publicUrl: nullableText,
  createdAt: instant,
  updatedAt: instant,
});
export type BookingType = z.infer<typeof bookingTypeSchema>;

export const bookingTypeListSchema = z.object({ data: z.array(bookingTypeSchema) });

/** What a create or update sends: the type with all its children, replaced as a whole (Reference's behaviour). */
export type BookingTypeInput = Omit<
  BookingType,
  'id' | 'rowVersion' | 'appointmentsCount' | 'publicUrl' | 'createdAt' | 'updatedAt' | 'sortOrder'
>;

export const slotSchema = z.object({
  start: instant,
  end: instant,
  remaining: z.number().int().nullable().optional(),
});

export const slotListSchema = z.object({ timezone: z.string(), slots: z.array(slotSchema) });
export type SlotList = z.infer<typeof slotListSchema>;

/** The in-progress editor state the preview endpoint reads (no saved type needed). */
export interface PreviewDraft {
  timezone: string;
  durationMinutes: number;
  incrementMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  maxPerDay: number | null;
  capacity: number;
  availability: Array<z.infer<typeof availabilityRuleSchema>>;
  overrides: Array<z.infer<typeof availabilityOverrideSchema>>;
}

// ---- settings ------------------------------------------------------------------------------------------------------

export const CALENDAR_STATUSES = [
  'unavailable',
  'disconnected',
  'connected',
  'needs_reconnect',
] as const;
export type CalendarState = (typeof CALENDAR_STATUSES)[number];

/**
 * The workspace's Google Calendar link. `unavailable`: the platform has no Google OAuth client; `disconnected`: it could be connected;
 * `needs_reconnect`: Google stopped honouring the grant. `account` is the connected Google account.
 */
export const calendarStatusSchema = z.object({
  provider: z.literal('google'),
  status: z.enum(CALENDAR_STATUSES),
  account: nullableText,
  calendarId: nullableText,
  calendarName: nullableText,
  connectedAt: instant.nullable(),
});
export type CalendarConnection = z.infer<typeof calendarStatusSchema>;

/** A calendar of the connected account that bookings can be written to. */
export const calendarOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  primary: z.boolean(),
  timezone: nullableText,
});
export type CalendarOption = z.infer<typeof calendarOptionSchema>;

export const calendarStartSchema = z.object({ url: z.string(), expiresInSeconds: z.number() });

export const bookingSettingsSchema = z.object({
  timezone: nullableText,
  slotDurationMinutes: z.number().int(),
  bufferBeforeMinutes: z.number().int(),
  bufferAfterMinutes: z.number().int(),
  maxPerDay: z.number().int(),
  advanceDays: z.number().int(),
  reminderMinutesBefore: z.number().int(),
  defaultLocation: z.string(),
  /** Business hours, the default weekly windows (0 = Sunday ... 6 = Saturday). */
  businessHours: z.array(availabilityRuleSchema),
  templates: z.object({
    confirmation: z.string(),
    reminder: z.string(),
    cancellation: z.string(),
    reschedule: z.string(),
  }),
  calendar: calendarStatusSchema,
  rowVersion: z.number().int().optional(),
});
export type BookingSettings = z.infer<typeof bookingSettingsSchema>;
export type BookingSettingsInput = Omit<BookingSettings, 'calendar' | 'rowVersion'>;

// ---- public pages --------------------------------------------------------------------------------------------------

export const publicOrgSchema = z.object({ name: z.string(), slug: z.string().optional() });

export const publicTypeSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: nullableText,
  locationType: z.enum(LOCATION_TYPES),
  locationValue: nullableText,
  color: nullableText,
  durationMinutes: z.number().int(),
  introMessage: nullableText,
  timezone: z.string(),
  maxAdvanceDays: z.number().int(),
  requiresApproval: z.boolean(),
  currency: nullableText,
  feeMinor: z.number().int(),
  taxPct: z.number(),
  dueNowMinor: z.number().int(),
  questions: z.array(bookingQuestionSchema),
  /** The optional consent line under the form (BL-167); null when the workspace wrote none. */
  consent: z
    .object({ text: z.string(), version: z.number().int(), url: nullableText })
    .nullable()
    .default(null),
});
export type PublicType = z.infer<typeof publicTypeSchema>;

export const publicDirectorySchema = z.object({
  org: publicOrgSchema,
  types: z.array(publicTypeSchema),
});
export type PublicDirectory = z.infer<typeof publicDirectorySchema>;

export const publicTypePageSchema = z.object({ org: publicOrgSchema, type: publicTypeSchema });
export type PublicTypePage = z.infer<typeof publicTypePageSchema>;

export const publicBookingSchema = z.object({
  /** The visitor's own view of a booking: what, when, where, and the secret link that manages it. */
  status: z.enum(APPOINTMENT_STATUSES),
  typeName: z.string(),
  startsAt: instant,
  endsAt: instant,
  timezone: z.string(),
  location: nullableText,
  locationType: z.enum(LOCATION_TYPES).nullable(),
  meetUrl: nullableText,
  description: nullableText,
  manageToken: z.string(),
  manageUrl: z.string(),
  canReschedule: z.boolean(),
  canCancel: z.boolean(),
  /** What cancelling now would record (never charged here). */
  cancelFee: z.object({ currency: nullableText, amount: z.string() }).nullable().optional(),
});
export type PublicBooking = z.infer<typeof publicBookingSchema>;

export const publicManageSchema = z.object({ org: publicOrgSchema, booking: publicBookingSchema });
export type PublicManage = z.infer<typeof publicManageSchema>;

export const publicBookedSchema = z.object({ org: publicOrgSchema, booking: publicBookingSchema });

export interface PublicBookInput {
  startsAt: string;
  name: string;
  email: string;
  phone?: string;
  inviteeTimezone: string;
  answers: Answer[];
  /** The visitor ticked the consent line shown at this version. Left out when the box was not ticked. */
  consent?: { given: true; version: number };
}
