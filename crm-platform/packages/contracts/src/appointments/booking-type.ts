import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { dealValueSchema, currencyCodeSchema } from '../deals-pipelines/money';

/**
 * Booking types (TW-APPT-005..015): the services a workspace sells time for. Everything a type owns (weekly hours, date overrides,
 * questions, reminders, lifecycle messages, price, calendar target) travels in the same body, as in Reference's wizard, but an absent
 * child list means "keep" (Reference replaced every child on every save and so wiped the date overrides).
 */

export const BOOKING_LOCATION_TYPES = ['address', 'virtual', 'phone', 'whatsapp'] as const;
export const bookingLocationTypeSchema = z.enum(BOOKING_LOCATION_TYPES);
export type BookingLocationType = z.infer<typeof bookingLocationTypeSchema>;

export const BOOKING_QUESTION_TYPES = [
  'text',
  'textarea',
  'select',
  'number',
  'email',
  'phone',
  'date',
] as const;
export const bookingQuestionTypeSchema = z.enum(BOOKING_QUESTION_TYPES);
export type BookingQuestionType = z.infer<typeof bookingQuestionTypeSchema>;

/** The contact fields a question can fill (Reference: email, name, mobile). */
export const BOOKING_MAP_FIELDS = ['name', 'email', 'phone'] as const;
export const bookingMapFieldSchema = z.enum(BOOKING_MAP_FIELDS);
export type BookingMapField = z.infer<typeof bookingMapFieldSchema>;

export const BOOKING_TEMPLATE_EVENTS = [
  'confirmation',
  'reminder',
  'cancellation',
  'reschedule',
] as const;
export const bookingTemplateEventSchema = z.enum(BOOKING_TEMPLATE_EVENTS);
export type BookingTemplateEvent = z.infer<typeof bookingTemplateEventSchema>;

export const BOOKING_TEMPLATE_CHANNELS = [
  'whatsapp',
  'email',
  'telegram',
  'instagram',
  'facebook',
] as const;
export const bookingTemplateChannelSchema = z.enum(BOOKING_TEMPLATE_CHANNELS);
export type BookingTemplateChannel = z.infer<typeof bookingTemplateChannelSchema>;

export const BOOKING_DEPOSIT_MODES = ['none', 'partial', 'full'] as const;
export const bookingDepositModeSchema = z.enum(BOOKING_DEPOSIT_MODES);
export type BookingDepositMode = z.infer<typeof bookingDepositModeSchema>;

export const BOOKING_REMINDERS_MAX = 8;
export const BOOKING_QUESTIONS_MAX = 20;
export const BOOKING_OVERRIDES_MAX = 400;
export const BOOKING_REMINDER_MAX_MINUTES = 43_200; // 30 days

/** A valid IANA zone name, checked by the platform's own tz database. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, 'timezone must be an IANA zone such as "Asia/Kolkata"');

/** `HH:MM`, 24-hour. */
export const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM (24-hour)');
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'date must be YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'not a calendar date');

/** Minutes after midnight of an `HH:MM` string. */
export const clockMinutes = (t: string): number =>
  Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** One weekly interval; `weekday` 0 = Sunday ... 6 = Saturday, times in the booking type's zone. */
export const availabilityWindowSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    from: clockTimeSchema,
    to: clockTimeSchema,
  })
  .refine((w) => clockMinutes(w.to) > clockMinutes(w.from), {
    message: '`to` must be after `from`',
    path: ['to'],
  });
export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>;

/** True when two intervals of one weekday overlap. */
export function overlappingWindows(windows: AvailabilityWindow[]): boolean {
  const byDay = new Map<number, AvailabilityWindow[]>();
  for (const w of windows) byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), w]);
  for (const list of byDay.values()) {
    const sorted = [...list].sort((a, b) => clockMinutes(a.from) - clockMinutes(b.from));
    for (let i = 1; i < sorted.length; i++) {
      if (clockMinutes(sorted[i]!.from) < clockMinutes(sorted[i - 1]!.to)) return true;
    }
  }
  return false;
}

export const availabilityListSchema = z
  .array(availabilityWindowSchema)
  .max(70)
  .refine((w) => !overlappingWindows(w), 'intervals of the same weekday overlap');

/** The hours half of an override: a closed date has none, special hours need both ends. */
function checkOverrideHours(
  o: { isClosed: boolean; from?: string | null; to?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (o.isClosed) {
    if (o.from || o.to)
      ctx.addIssue({ code: 'custom', message: 'a closed date has no hours', path: ['from'] });
    return;
  }
  if (!o.from || !o.to) {
    ctx.addIssue({ code: 'custom', message: 'special hours need `from` and `to`', path: ['from'] });
    return;
  }
  if (clockMinutes(o.to) <= clockMinutes(o.from))
    ctx.addIssue({ code: 'custom', message: '`to` must be after `from`', path: ['to'] });
}

/** A closed date, or special hours that replace that date's weekly intervals. */
export const dateOverrideSchema = z
  .object({
    date: localDateSchema,
    isClosed: z.boolean().default(false),
    from: clockTimeSchema.nullish(),
    to: clockTimeSchema.nullish(),
    reason: z.string().trim().max(200).nullish(),
  })
  .superRefine(checkOverrideHours);
export type DateOverrideInput = z.infer<typeof dateOverrideSchema>;

/** `PUT /booking-types/:id/overrides/:date`: the date is in the path. */
export const upsertOverrideSchema = z
  .object({
    isClosed: z.boolean().default(false),
    from: clockTimeSchema.nullish(),
    to: clockTimeSchema.nullish(),
    reason: z.string().trim().max(200).nullish(),
  })
  .superRefine(checkOverrideHours);
export type UpsertOverrideInput = z.infer<typeof upsertOverrideSchema>;

export const bookingQuestionInputSchema = z
  .object({
    /** Send the id of an existing question to keep it; omit for a new one. */
    id: uuidSchema.optional(),
    label: z.string().trim().min(1).max(191),
    type: bookingQuestionTypeSchema.default('text'),
    /** Choices of a `select` question. */
    options: z.array(z.string().trim().min(1).max(191)).max(50).nullish(),
    required: z.boolean().default(true),
    mapToContactField: bookingMapFieldSchema.nullish(),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'select' && (!q.options || q.options.length === 0))
      ctx.addIssue({
        code: 'custom',
        message: 'a select question needs options',
        path: ['options'],
      });
  });
export type BookingQuestionInput = z.infer<typeof bookingQuestionInputSchema>;

/**
 * `before`: this many minutes before the start. `after`: this many minutes after the end (the after-visit step; a rebook step is
 * `after` too, counted up to a year). `event`: sent when something happens (the booking is made, a visit is marked no-show), not at a time.
 */
export const BOOKING_REMINDER_KINDS = ['before', 'after', 'event'] as const;
export const bookingReminderKindSchema = z.enum(BOOKING_REMINDER_KINDS);
export type BookingReminderKind = z.infer<typeof bookingReminderKindSchema>;

/**
 * The steps of a reminder SEQUENCE. `confirmation` (right after the booking) and `no_show` (when a visit is marked no-show) are event
 * steps. `reminder_24h`, `reminder_2h` and `reminder_15m` are the usual before-the-start steps (the 15 minute one only goes for an
 * online visit that has a join link); `reminder` is any other time before the start. `after_visit` goes after the end, `rebook` goes
 * N days after a completed visit (a recall).
 */
export const BOOKING_REMINDER_STEP_KINDS = [
  'confirmation',
  'reminder_24h',
  'reminder_2h',
  'reminder_15m',
  'reminder',
  'after_visit',
  'no_show',
  'rebook',
] as const;
export const bookingReminderStepKindSchema = z.enum(BOOKING_REMINDER_STEP_KINDS);
export type BookingReminderStepKind = z.infer<typeof bookingReminderStepKindSchema>;

/** The steps that are sent when something happens; they have no time of their own. */
export const BOOKING_EVENT_STEP_KINDS = ['confirmation', 'no_show'] as const;
/**
 * An event step has no time. It takes a fixed offset (0 for the confirmation, 1 for the no-show message) so that the (kind, offset) key
 * of a rule still tells every step apart; no timed step uses an offset below 1 of the `event` kind.
 */
export const EVENT_STEP_OFFSET = { confirmation: 0, no_show: 1 } as const;
/** At most this many steps with a time (before the start, after the end, a rebook); the event steps come on top. */
export const BOOKING_TIMED_STEPS_MAX = 5;
/** A rebook step can wait up to a year after the visit. */
export const BOOKING_REBOOK_MAX_MINUTES = 525_600;

export const isEventStep = (k: BookingReminderStepKind): boolean =>
  (BOOKING_EVENT_STEP_KINDS as readonly string[]).includes(k);

/** The kind a step has in storage. */
export function reminderKindOfStep(step: BookingReminderStepKind): BookingReminderKind {
  if (isEventStep(step)) return 'event';
  return step === 'after_visit' || step === 'rebook' ? 'after' : 'before';
}

/** The step a rule without an explicit step is read as: the usual offsets get their name. */
export function defaultStepKind(
  kind: BookingReminderKind,
  offsetMinutes: number,
): BookingReminderStepKind {
  if (kind === 'after') return 'after_visit';
  if (kind === 'event') return 'confirmation';
  if (offsetMinutes === 1440) return 'reminder_24h';
  if (offsetMinutes === 120) return 'reminder_2h';
  if (offsetMinutes === 15) return 'reminder_15m';
  return 'reminder';
}

/**
 * The channels a step can go out on, in the order a step tries them by default. SMS was removed from appointment messages (DLT and
 * per-country rules make it unreliable); `voice` is reserved for the outbound reminder call and cannot be chosen yet.
 */
export const BOOKING_REMINDER_CHANNELS = ['whatsapp', 'email'] as const;
export const bookingReminderChannelSchema = z.enum(BOOKING_REMINDER_CHANNELS);
export type BookingReminderChannel = z.infer<typeof bookingReminderChannelSchema>;

/**
 * Every channel a delivery record can name when it is READ: the removed `sms` stays here because old runs carry it as history, `voice`
 * because it is reserved. Never accepted as input.
 */
export const BOOKING_REMINDER_RECORD_CHANNELS = ['whatsapp', 'email', 'sms', 'voice'] as const;
export const bookingReminderRecordChannelSchema = z.enum(BOOKING_REMINDER_RECORD_CHANNELS);
export type BookingReminderRecordChannel = z.infer<typeof bookingReminderRecordChannelSchema>;

/** The placeholders a reminder text may use (the same ones the booking messages use). */
export const BOOKING_REMINDER_PLACEHOLDERS = [
  'name',
  'type',
  'title',
  'slot',
  'date',
  'time',
  'location',
  'join_link',
  'manage_link',
] as const;

export const BOOKING_REMINDER_BODY_MAX = 2000;
export const BOOKING_REMINDER_SUBJECT_MAX = 191;
/** "If it was not delivered after N minutes, use the next channel": the range of N and its default. */
export const BOOKING_UNDELIVERED_MIN = 5;
export const BOOKING_UNDELIVERED_MAX = 720;
export const BOOKING_UNDELIVERED_DEFAULT = 30;

export const bookingReminderInputSchema = z
  .object({
    id: uuidSchema.optional(),
    /** Minutes before the start (`before`), after the end (`after`; a rebook may reach a year), or the fixed offset of an event step. */
    offsetMinutes: z.number().int().min(0).max(BOOKING_REBOOK_MAX_MINUTES),
    label: z.string().trim().max(40).nullish(),
    /** A rule is OFF unless it is switched on: a new rule never sends by surprise. */
    isActive: z.boolean().default(false),
    kind: bookingReminderKindSchema.default('before'),
    /** Which step of the sequence this is. Left out = read from the kind and the offset (1440 minutes before is the 24 hour reminder). */
    stepKind: bookingReminderStepKindSchema.optional(),
    /** Ordered preference: the first channel the contact can be reached on, with a connected sender, wins; the rest are fallbacks. */
    channels: z
      .array(bookingReminderChannelSchema)
      .min(1)
      .max(BOOKING_REMINDER_CHANNELS.length)
      .refine((c) => new Set(c).size === c.length, 'a channel is listed once')
      .default(['whatsapp', 'email']),
    /** An email's subject line; blank = a default one. */
    subject: z.string().trim().max(BOOKING_REMINDER_SUBJECT_MAX).nullish(),
    /** The text, with placeholders; blank = the type's reminder message (before) or the built-in follow-up text (after). */
    body: z.string().trim().max(BOOKING_REMINDER_BODY_MAX).nullish(),
    /** An approved WhatsApp template of the workspace. Needed to reach a contact on WhatsApp outside the 24 hour window. */
    waTemplateId: uuidSchema.nullish(),
    /** An email message of the appointment library; it is read when the message is sent, so editing it changes what goes out. */
    libraryTemplateId: uuidSchema.nullish(),
    /** The reminder carries Confirm, Reschedule and Cancel buttons (WhatsApp quick replies). */
    buttonsEnabled: z.boolean().default(false),
    /** Skip this step when the customer has already confirmed (used on the 2 hour reminder). */
    skipIfConfirmed: z.boolean().default(false),
    /** Use the next channel when the message was not delivered after this many minutes. Null = off. */
    undeliveredFallbackMinutes: z
      .number()
      .int()
      .min(BOOKING_UNDELIVERED_MIN)
      .max(BOOKING_UNDELIVERED_MAX)
      .nullish(),
  })
  .superRefine((r, ctx) => {
    const step = r.stepKind ?? defaultStepKind(r.kind, r.offsetMinutes);
    if (reminderKindOfStep(step) !== r.kind) {
      ctx.addIssue({
        code: 'custom',
        message: 'this step does not go with that kind',
        path: ['stepKind'],
      });
    }
    if (r.kind === 'event') {
      if (r.offsetMinutes !== EVENT_STEP_OFFSET[step as 'confirmation' | 'no_show']) {
        ctx.addIssue({
          code: 'custom',
          message: 'an event step has no time',
          path: ['offsetMinutes'],
        });
      }
      return;
    }
    const max = step === 'rebook' ? BOOKING_REBOOK_MAX_MINUTES : BOOKING_REMINDER_MAX_MINUTES;
    if (r.offsetMinutes < 1 || r.offsetMinutes > max) {
      ctx.addIssue({
        code: 'custom',
        message: `a time between 1 minute and ${step === 'rebook' ? '365 days' : '30 days'}`,
        path: ['offsetMinutes'],
      });
    }
  });
export type BookingReminderInput = z.infer<typeof bookingReminderInputSchema>;

export const bookingTemplateInputSchema = z.object({
  event: bookingTemplateEventSchema,
  channel: bookingTemplateChannelSchema.default('whatsapp'),
  /** A WhatsApp template of the workspace, used instead of the plain body. */
  waTemplateId: uuidSchema.nullish(),
  /** A message of the appointment library (email, or an APPROVED WhatsApp one); it is read when the message is sent, so editing it updates every type that chose it. */
  libraryTemplateId: uuidSchema.nullish(),
  /** Variables: {{type}} {{slot}} {{name}} {{date}} {{time}} {{location}} {{manage_link}}. */
  plainBody: z.string().trim().max(2000).nullish(),
  variableMap: z.record(z.string().max(60), z.string().max(200)).nullish(),
});
export type BookingTemplateInput = z.infer<typeof bookingTemplateInputSchema>;

/** Money is a decimal string in major units ("150.00"); the currency decides how many decimals it may have. */
export const bookingPaymentInputSchema = z.object({
  currency: currencyCodeSchema.nullish(),
  fee: dealValueSchema.default('0'),
  taxPercent: z
    .string()
    .trim()
    .regex(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/, 'tax must be 0 to 100 with at most 2 decimals')
    .default('0'),
  gatewaySlug: z.string().trim().max(64).nullish(),
  depositMode: bookingDepositModeSchema.default('none'),
  deposit: dealValueSchema.default('0'),
  autoSendLink: z.boolean().default(true),
  cancelFee: dealValueSchema.default('0'),
  noShowFee: dealValueSchema.default('0'),
  cancelWindowMinutes: z.number().int().min(0).max(525_600).default(1440),
});
export type BookingPaymentInput = z.infer<typeof bookingPaymentInputSchema>;

export const bookingCalendarInputSchema = z.object({
  calendarId: z.string().trim().max(191).nullish(),
  createMeet: z.boolean().optional(),
  spreadsheetId: z.string().trim().max(191).nullish(),
  sheetRange: z.string().trim().max(64).nullish(),
});
export type BookingCalendarInput = z.infer<typeof bookingCalendarInputSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colour must be #RRGGBB');

const stepOf = (r: BookingReminderInput): BookingReminderStepKind =>
  r.stepKind ?? defaultStepKind(r.kind, r.offsetMinutes);

const distinctOffsets = (r: BookingReminderInput[]) =>
  new Set(r.map((x) => `${stepOf(x)}:${x.kind}:${x.offsetMinutes}`)).size === r.length;

const withinTimedCap = (r: BookingReminderInput[]) =>
  r.filter((x) => x.kind !== 'event').length <= BOOKING_TIMED_STEPS_MAX;

const childShape = {
  availability: availabilityListSchema.optional(),
  overrides: z.array(dateOverrideSchema).max(BOOKING_OVERRIDES_MAX).optional(),
  questions: z.array(bookingQuestionInputSchema).max(BOOKING_QUESTIONS_MAX).optional(),
  reminders: z
    .array(bookingReminderInputSchema)
    .max(BOOKING_REMINDERS_MAX)
    .refine(distinctOffsets, 'reminder times must be distinct')
    .refine(withinTimedCap, `at most ${BOOKING_TIMED_STEPS_MAX} steps with a time`)
    .optional(),
  templates: z.array(bookingTemplateInputSchema).max(20).optional(),
  payment: bookingPaymentInputSchema.optional(),
  calendar: bookingCalendarInputSchema.optional(),
};

export const createBookingTypeSchema = z.object({
  name: z.string().trim().min(1).max(191),
  /** Made unique per workspace by a numeric suffix; derived from the name when absent. */
  slug: z.string().trim().max(191).nullish(),
  description: z.string().trim().max(5000).nullish(),
  locationType: bookingLocationTypeSchema.default('address'),
  locationValue: z.string().trim().max(1000).nullish(),
  color: hexColor.nullish(),
  introMessage: z.string().trim().max(2000).nullish(),
  /** A request that staff approve (pending) instead of confirming at once. */
  approvalRequired: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  /** The host: an active member; default the caller. */
  hostId: uuidSchema.nullish(),
  durationMinutes: z.number().int().min(5).max(1440),
  /** Start-time step; default the duration. */
  incrementMinutes: z.number().int().min(5).max(1440).optional(),
  bufferBeforeMinutes: z.number().int().min(0).max(1440).default(0),
  bufferAfterMinutes: z.number().int().min(0).max(1440).default(0),
  /** Smallest lead time, in minutes (Reference's form default: 4 hours). */
  minNoticeMinutes: z.number().int().min(0).max(525_600).default(240),
  /** Bookable days from today, today included. */
  maxAdvanceDays: z.number().int().min(1).max(365).default(30),
  /** At most this many bookings start on one local day; null = no cap. */
  maxPerDay: z.number().int().min(1).max(500).nullish(),
  /** Seats per slot: 1 = one-to-one, above 1 = a group session. */
  capacity: z.number().int().min(1).max(500).default(1),
  /** IANA zone the weekly hours are written in; null follows the workspace zone. */
  timezone: timeZoneSchema.nullish(),
  ...childShape,
});
export type CreateBookingTypeInput = z.infer<typeof createBookingTypeSchema>;

/** Absent keeps, `null` clears where a field can be empty; a child list sent replaces that list (ids keep their rows). */
export const updateBookingTypeSchema = z.object({
  name: z.string().trim().min(1).max(191).optional(),
  slug: z.string().trim().min(1).max(191).optional(),
  description: z.string().trim().max(5000).nullish(),
  locationType: bookingLocationTypeSchema.optional(),
  locationValue: z.string().trim().max(1000).nullish(),
  color: hexColor.nullish(),
  introMessage: z.string().trim().max(2000).nullish(),
  approvalRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  hostId: uuidSchema.nullish(),
  durationMinutes: z.number().int().min(5).max(1440).optional(),
  incrementMinutes: z.number().int().min(5).max(1440).optional(),
  bufferBeforeMinutes: z.number().int().min(0).max(1440).optional(),
  bufferAfterMinutes: z.number().int().min(0).max(1440).optional(),
  minNoticeMinutes: z.number().int().min(0).max(525_600).optional(),
  maxAdvanceDays: z.number().int().min(1).max(365).optional(),
  maxPerDay: z.number().int().min(1).max(500).nullish(),
  capacity: z.number().int().min(1).max(500).optional(),
  timezone: timeZoneSchema.nullish(),
  ...childShape,
  rowVersion: z.number().int().positive(),
});
export type UpdateBookingTypeInput = z.infer<typeof updateBookingTypeSchema>;

export const listBookingTypesQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  active: z
    .preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
    .optional(),
});
export type ListBookingTypesQuery = z.infer<typeof listBookingTypesQuerySchema>;

// --- responses --------------------------------------------------------------------------------------------------------------

const userRefSchema = z.object({ id: uuidSchema, name: z.string() });

export const bookingQuestionSchema = z.object({
  id: uuidSchema,
  label: z.string(),
  type: bookingQuestionTypeSchema,
  options: z.array(z.string()).nullable(),
  required: z.boolean(),
  mapToContactField: bookingMapFieldSchema.nullable(),
  sortOrder: z.number().int(),
});
export type BookingQuestion = z.infer<typeof bookingQuestionSchema>;

/** What a step's WhatsApp message is: read live from the template, never copied, so it cannot say approved after Meta paused it. */
export const BOOKING_REMINDER_WA_STATUSES = ['draft', 'pending', 'approved', 'rejected'] as const;

export const bookingReminderSchema = z.object({
  id: uuidSchema,
  offsetMinutes: z.number().int(),
  label: z.string().nullable(),
  isActive: z.boolean(),
  kind: bookingReminderKindSchema,
  stepKind: bookingReminderStepKindSchema,
  channels: z.array(bookingReminderChannelSchema),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  waTemplateId: uuidSchema.nullable(),
  /** The WhatsApp message's own status and name (for the chip next to the step). Null when the step has no WhatsApp template. */
  waTemplateStatus: z.enum(BOOKING_REMINDER_WA_STATUSES).nullable(),
  waTemplateName: z.string().nullable(),
  libraryTemplateId: uuidSchema.nullable(),
  buttonsEnabled: z.boolean(),
  skipIfConfirmed: z.boolean(),
  undeliveredFallbackMinutes: z.number().int().nullable(),
  /** `sms_removed`: SMS reminders were removed; the step was moved to email or switched off, and the owner chooses WhatsApp or email. */
  notice: z.enum(['sms_removed']).nullable(),
});
export type BookingReminder = z.infer<typeof bookingReminderSchema>;

export const bookingTemplateSchema = z.object({
  event: bookingTemplateEventSchema,
  channel: bookingTemplateChannelSchema,
  waTemplateId: uuidSchema.nullable(),
  libraryTemplateId: uuidSchema.nullable(),
  plainBody: z.string().nullable(),
  variableMap: z.record(z.string()).nullable(),
});
export type BookingTemplate = z.infer<typeof bookingTemplateSchema>;

export const bookingPaymentSchema = z.object({
  currency: z.string().nullable(),
  fee: z.string(),
  taxPercent: z.string(),
  /** fee + tax, rounded to the currency's minor unit. */
  total: z.string(),
  gatewaySlug: z.string().nullable(),
  depositMode: bookingDepositModeSchema,
  deposit: z.string(),
  /** What the customer owes to book: the total (full), the deposit (partial) or 0. */
  dueNow: z.string(),
  autoSendLink: z.boolean(),
  cancelFee: z.string(),
  noShowFee: z.string(),
  cancelWindowMinutes: z.number().int(),
});
export type BookingPayment = z.infer<typeof bookingPaymentSchema>;

export const bookingCalendarSchema = z.object({
  calendarId: z.string().nullable(),
  createMeet: z.boolean(),
  spreadsheetId: z.string().nullable(),
  sheetRange: z.string(),
});
export type BookingCalendar = z.infer<typeof bookingCalendarSchema>;

export const bookingOverrideSchema = z.object({
  date: z.string(),
  isClosed: z.boolean(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  reason: z.string().nullable(),
});
export type BookingOverride = z.infer<typeof bookingOverrideSchema>;

export const bookingTypeResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  locationType: bookingLocationTypeSchema,
  locationValue: z.string().nullable(),
  color: z.string().nullable(),
  introMessage: z.string().nullable(),
  durationMinutes: z.number().int(),
  incrementMinutes: z.number().int(),
  bufferBeforeMinutes: z.number().int(),
  bufferAfterMinutes: z.number().int(),
  minNoticeMinutes: z.number().int(),
  maxAdvanceDays: z.number().int(),
  maxPerDay: z.number().int().nullable(),
  capacity: z.number().int(),
  /** As stored (null = follows the workspace). */
  timezone: z.string().nullable(),
  /** The zone the hours are really read in. */
  effectiveTimezone: z.string(),
  approvalRequired: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  host: userRefSchema.nullable(),
  /** Where customers book it: `/book/<workspace slug>/<slug>` on the web app. */
  publicPath: z.string(),
  publicUrl: z.string(),
  availability: z.array(availabilityWindowSchema),
  overrides: z.array(bookingOverrideSchema),
  questions: z.array(bookingQuestionSchema),
  reminders: z.array(bookingReminderSchema),
  templates: z.array(bookingTemplateSchema),
  payment: bookingPaymentSchema,
  calendar: bookingCalendarSchema,
  /** Every booking ever made for it (all statuses). */
  appointmentsCount: z.number().int(),
  /** Pending or confirmed bookings that have not started. */
  upcomingCount: z.number().int(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BookingTypeResponse = z.infer<typeof bookingTypeResponseSchema>;

export const bookingTypeListResponseSchema = z.object({ data: z.array(bookingTypeResponseSchema) });
export type BookingTypeListResponse = z.infer<typeof bookingTypeListResponseSchema>;

/** The lightweight list for pickers (the flow builder's "Service" dropdown). */
export const bookingTypeOptionSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  durationMinutes: z.number().int(),
  isActive: z.boolean(),
});
export type BookingTypeOption = z.infer<typeof bookingTypeOptionSchema>;
