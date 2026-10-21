import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { appointmentMessageKindSchema } from './channels';
import {
  BOOKING_REMINDER_WA_STATUSES,
  bookingReminderChannelSchema,
  bookingReminderKindSchema,
  bookingReminderSchema,
  bookingReminderStepKindSchema,
} from './booking-type';

/**
 * Reminder sequences, part 2 (BL-421..BL-429): packs (predefined sequences with their messages), the email test-send, the delivery
 * reports and the customer's quick reply. See docs/api/appointment-reminder-sequences.md.
 */

// --- packs ---------------------------------------------------------------------------------------------------------------------

/** The seven packs. The key is part of the WhatsApp template names (`appt_<pack>_<step>_<lang>`), so it never changes. */
export const REMINDER_PACK_KEYS = [
  'clinic',
  'dental',
  'salon_spa',
  'property_visit',
  'sales_meeting',
  'fitness_wellness',
  'home_auto_service',
] as const;
export const reminderPackKeySchema = z.enum(REMINDER_PACK_KEYS);
export type ReminderPackKey = z.infer<typeof reminderPackKeySchema>;

/** The languages a pack ships in. Hindi is a machine draft (marked as such on the screen) until a person has read it. */
export const REMINDER_PACK_LANGUAGES = ['en', 'hi'] as const;
export const reminderPackLanguageSchema = z.enum(REMINDER_PACK_LANGUAGES);
export type ReminderPackLanguage = z.infer<typeof reminderPackLanguageSchema>;

export const reminderPackStepSchema = z.object({
  stepKind: bookingReminderStepKindSchema,
  kind: bookingReminderKindSchema,
  /** Minutes before the start, after the end, or the fixed offset of an event step. A rebook counts days after the visit. */
  offsetMinutes: z.number().int().nonnegative(),
  /** Whether the pack switches the step on (the after-visit and rebook steps of some packs ship OFF). */
  isActive: z.boolean(),
  channels: z.array(bookingReminderChannelSchema).min(1),
  /** The WhatsApp message carries Confirm, Reschedule and Cancel buttons. */
  buttons: z.boolean(),
  skipIfConfirmed: z.boolean(),
  /** Only an online visit that has a join link gets this step. */
  onlineOnly: z.boolean(),
  /** `MARKETING` for the after-visit and rebook steps: the consent gate applies. */
  metaCategory: z.enum(['UTILITY', 'MARKETING']),
  messageKind: appointmentMessageKindSchema,
});
export type ReminderPackStep = z.infer<typeof reminderPackStepSchema>;

export const reminderPackSchema = z.object({
  key: reminderPackKeySchema,
  /** Bumped when the content changes; a workspace that adopted an older version keeps its copy until it applies the pack again. */
  version: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  languages: z.array(reminderPackLanguageSchema),
  /** The languages whose text is a machine draft. */
  machineDrafted: z.array(reminderPackLanguageSchema),
  steps: z.array(reminderPackStepSchema),
});
export type ReminderPack = z.infer<typeof reminderPackSchema>;

export const reminderPacksResponseSchema = z.object({ data: z.array(reminderPackSchema) });
export type ReminderPacksResponse = z.infer<typeof reminderPacksResponseSchema>;

export const reminderPackPreviewInputSchema = z.object({
  bookingTypeId: uuidSchema,
  language: reminderPackLanguageSchema.default('en'),
});
export type ReminderPackPreviewInput = z.infer<typeof reminderPackPreviewInputSchema>;

export const REMINDER_PACK_ACTIONS = ['add', 'replace', 'unchanged'] as const;

export const reminderPackPreviewStepSchema = z.object({
  step: reminderPackStepSchema,
  /** What applying the pack does to this step: add it, replace the type's own rule for it, or nothing (already identical). */
  action: z.enum(REMINDER_PACK_ACTIONS),
  /** The rule the type has now for this step, if any. */
  existing: z
    .object({
      id: uuidSchema,
      isActive: z.boolean(),
      offsetMinutes: z.number().int(),
      hasOwnText: z.boolean(),
    })
    .nullable(),
  email: z.object({ subject: z.string(), body: z.string() }),
  whatsapp: z.object({
    templateName: z.string(),
    /** The body with the placeholders written as names, so the owner can read it. */
    body: z.string(),
    /** `new`: it will be created as a draft and sent to Meta. Otherwise the status of the template this workspace already has. */
    status: z.enum(['new', ...BOOKING_REMINDER_WA_STATUSES]),
    buttons: z.array(z.string()),
  }),
});
export type ReminderPackPreviewStep = z.infer<typeof reminderPackPreviewStepSchema>;

export const reminderPackPreviewSchema = z.object({
  pack: reminderPackSchema,
  language: reminderPackLanguageSchema,
  bookingType: z.object({ id: uuidSchema, name: z.string(), online: z.boolean() }),
  steps: z.array(reminderPackPreviewStepSchema),
  /** Steps the type has that the pack does not touch (kept as they are). */
  kept: z.array(z.object({ id: uuidSchema, stepKind: bookingReminderStepKindSchema, offsetMinutes: z.number().int() })),
  timedSteps: z.number().int(),
  timedStepsMax: z.number().int(),
  /** `cap_exceeded`: applying the pack would pass the limit of steps with a time; nothing can be applied until one is removed. */
  blocked: z.enum(['cap_exceeded']).nullable(),
  /** Some step would replace something the owner wrote or changed: the owner has to confirm it. */
  needsConfirm: z.boolean(),
});
export type ReminderPackPreview = z.infer<typeof reminderPackPreviewSchema>;

export const reminderPackAdoptInputSchema = z.object({
  bookingTypeId: uuidSchema,
  language: reminderPackLanguageSchema.default('en'),
  /** Required when the preview said `needsConfirm`: without it nothing is overwritten (409). */
  confirmReplace: z.boolean().default(false),
  /** Send the new WhatsApp templates to Meta now (default) or leave them as drafts. */
  submitToMeta: z.boolean().default(true),
});
export type ReminderPackAdoptInput = z.infer<typeof reminderPackAdoptInputSchema>;

export const reminderPackAdoptResultSchema = z.object({
  reminders: z.array(bookingReminderSchema),
  templates: z.array(
    z.object({
      name: z.string(),
      status: z.enum(BOOKING_REMINDER_WA_STATUSES),
      created: z.boolean(),
      /** Meta's own sentence when the submission was refused; the template stays a draft. */
      metaError: z.string().nullable(),
    }),
  ),
  added: z.number().int(),
  replaced: z.number().int(),
});
export type ReminderPackAdoptResult = z.infer<typeof reminderPackAdoptResultSchema>;

// --- test-send -----------------------------------------------------------------------------------------------------------------

/** An email-only test of one step, sent to the signed-in user's own address. There is no WhatsApp test-send. */
export const reminderTestSendResultSchema = z.object({
  status: z.enum(['sent', 'skipped', 'failed']),
  reason: z.string().nullable(),
  /** The address it went to, masked (`a***@example.com`). */
  sentTo: z.string().nullable(),
});
export type ReminderTestSendResult = z.infer<typeof reminderTestSendResultSchema>;

// --- reports -------------------------------------------------------------------------------------------------------------------

export const reminderReportQuerySchema = z.object({
  bookingTypeId: uuidSchema.optional(),
  /** Window of the step's due time; default the last 30 days. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ReminderReportQuery = z.infer<typeof reminderReportQuerySchema>;

/** A rate is null when nothing was sent (no denominator), never 0. */
const rate = z.number().min(0).max(1).nullable();

export const reminderReportStepSchema = z.object({
  stepKind: bookingReminderStepKindSchema,
  sent: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  /** Why steps were skipped: reason code to count. */
  skippedReasons: z.record(z.string(), z.number().int()),
  /** Of the bookings this step was sent for: how many later confirmed, cancelled or became no-shows. */
  confirmationRate: rate,
  cancelRate: rate,
  noShowRate: rate,
});
export type ReminderReportStep = z.infer<typeof reminderReportStepSchema>;

export const reminderReportTypeSchema = z.object({
  bookingTypeId: uuidSchema,
  bookingTypeName: z.string(),
  appointments: z.number().int(),
  confirmationRate: rate,
  cancelRate: rate,
  noShowRate: rate,
  steps: z.array(reminderReportStepSchema),
});
export type ReminderReportType = z.infer<typeof reminderReportTypeSchema>;

export const reminderReportSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  data: z.array(reminderReportTypeSchema),
});
export type ReminderReport = z.infer<typeof reminderReportSchema>;

// --- the customer's quick reply -----------------------------------------------------------------------------------------------

/** The three buttons of the 24 hour reminder. The id is what a token carries; the labels are the template's. */
export const REMINDER_REPLY_ACTIONS = ['confirm', 'reschedule', 'cancel'] as const;
export const reminderReplyActionSchema = z.enum(REMINDER_REPLY_ACTIONS);
export type ReminderReplyAction = z.infer<typeof reminderReplyActionSchema>;

/** Plan features that gate parts of a sequence (default on; listed in the plan editor). */
export const REMINDER_CONFIRM_BUTTONS_FEATURE = 'appointment_confirm_buttons';
export const REMINDER_REBOOK_FEATURE = 'appointment_rebook_steps';
