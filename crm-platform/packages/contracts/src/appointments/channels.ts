import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Owner-enabled appointment channels and the predefined message library (BL-350..BL-354).
 *
 * The workspace owner decides which channels may carry appointment messages. A booking type lists only the channels that are enabled AND
 * connected. The library holds the messages (confirmation, reminder, reschedule, cancellation, after-visit follow-up) the owner adopts
 * from a predefined set and edits; an email message lives in the app, a WhatsApp message is a normal WhatsApp template submitted to Meta
 * and only an approved one can be chosen. `voice` (the outbound reminder call) is reserved: it can be listed, never enabled, until the
 * Voice bot exists.
 */

/** Every channel id a booking message can name. `voice` is reserved for the outbound reminder call. */
export const APPOINTMENT_CHANNELS = ['email', 'whatsapp', 'sms', 'voice'] as const;
export const appointmentChannelSchema = z.enum(APPOINTMENT_CHANNELS);
export type AppointmentChannel = z.infer<typeof appointmentChannelSchema>;

/** The channels that can be used today. */
export const APPOINTMENT_LIVE_CHANNELS = ['email', 'whatsapp', 'sms'] as const;

/** Channels the library can hold a message for (an SMS uses the plain text of the booking type or rule, not a library entry). */
export const APPOINTMENT_TEMPLATE_CHANNELS = ['email', 'whatsapp'] as const;
export const appointmentTemplateChannelSchema = z.enum(APPOINTMENT_TEMPLATE_CHANNELS);
export type AppointmentTemplateChannel = z.infer<typeof appointmentTemplateChannelSchema>;

export const APPOINTMENT_MESSAGE_KINDS = [
  'confirmation',
  'reminder',
  'reschedule',
  'cancellation',
  'follow_up',
] as const;
export const appointmentMessageKindSchema = z.enum(APPOINTMENT_MESSAGE_KINDS);
export type AppointmentMessageKind = z.infer<typeof appointmentMessageKindSchema>;

// --- channel settings ---------------------------------------------------------------------------------------------------------

/** `connected`: a sender is connected. `not_connected`: the owner has to connect one in Settings. `coming_soon`: the channel does not exist yet. */
export const APPOINTMENT_CHANNEL_CONNECTIONS = ['connected', 'not_connected', 'coming_soon'] as const;

export const appointmentChannelSenderSchema = z.object({
  id: uuidSchema,
  /** What the owner recognises it by: a number, a mailbox address or a label. */
  label: z.string(),
});
export type AppointmentChannelSender = z.infer<typeof appointmentChannelSenderSchema>;

export const appointmentChannelStateSchema = z.object({
  channel: appointmentChannelSchema,
  /** The owner (or, for a workspace that existed before this setting, the product's default) has switched it on. */
  enabled: z.boolean(),
  /** Whether anyone has decided: false for a new workspace that has not chosen yet. */
  decided: z.boolean(),
  /** Who decided: `legacy_default` = kept as it was before the setting existed. Null until decided. */
  source: z.enum(['owner', 'legacy_default']).nullable(),
  connection: z.enum(APPOINTMENT_CHANNEL_CONNECTIONS),
  /** Enabled and connected: the only state in which a booking type can use it. */
  usable: z.boolean(),
  senders: z.array(appointmentChannelSenderSchema),
  /** The chosen default sender, or null for "the first connected one". */
  defaultSenderId: uuidSchema.nullable(),
  rowVersion: z.number().int().nullable(),
});
export type AppointmentChannelState = z.infer<typeof appointmentChannelStateSchema>;

export const appointmentChannelsResponseSchema = z.object({
  data: z.array(appointmentChannelStateSchema),
});
export type AppointmentChannelsResponse = z.infer<typeof appointmentChannelsResponseSchema>;

export const updateAppointmentChannelSchema = z.object({
  enabled: z.boolean(),
  /** A sender of that channel, or null for "the first connected one". Left out = unchanged. */
  defaultSenderId: uuidSchema.nullable().optional(),
});
export type UpdateAppointmentChannelInput = z.infer<typeof updateAppointmentChannelSchema>;

// --- the library --------------------------------------------------------------------------------------------------------------

/**
 * What the library shows for a message. Email: always `approved` (it lives in the app). WhatsApp: read live from the linked template,
 * `draft` (not submitted), `pending` (Meta is reviewing it), `approved` (can be chosen), `rejected` (with Meta's reason).
 */
export const APPOINTMENT_TEMPLATE_STATUSES = ['draft', 'pending', 'approved', 'rejected'] as const;
export const appointmentTemplateStatusSchema = z.enum(APPOINTMENT_TEMPLATE_STATUSES);
export type AppointmentTemplateStatus = z.infer<typeof appointmentTemplateStatusSchema>;

export const APPOINTMENT_TEMPLATE_BODY_MAX = 4000;
export const APPOINTMENT_TEMPLATE_SUBJECT_MAX = 191;
export const APPOINTMENT_TEMPLATE_NAME_MAX = 120;

/** The language of a message: a Meta-style code (`en`, `pt_BR`). */
export const appointmentTemplateLanguageSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'a language code such as en or pt_BR');

export const appointmentTemplateSchema = z.object({
  id: uuidSchema,
  kind: appointmentMessageKindSchema,
  channel: appointmentTemplateChannelSchema,
  language: z.string(),
  name: z.string(),
  subject: z.string().nullable(),
  body: z.string(),
  /** The placeholders the body uses, in first-use order. */
  variables: z.array(z.string()),
  status: appointmentTemplateStatusSchema,
  /** Meta's words when it refused the template. */
  rejectionReason: z.string().nullable(),
  /** The WhatsApp template behind a WhatsApp message (open it in the template library for the Meta details). */
  waTemplateId: uuidSchema.nullable(),
  /** The WhatsApp number it is submitted through. */
  connectionId: uuidSchema.nullable(),
  /** The built-in message this was adopted from. */
  predefinedKey: z.string().nullable(),
  isActive: z.boolean(),
  /** Can be chosen for a send: active, and for WhatsApp approved. */
  usable: z.boolean(),
  /** How many booking types choose it. */
  usedByTypes: z.number().int(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AppointmentTemplate = z.infer<typeof appointmentTemplateSchema>;

export const listAppointmentTemplatesQuerySchema = z.object({
  kind: appointmentMessageKindSchema.optional(),
  channel: appointmentTemplateChannelSchema.optional(),
  /** Only the ones that can be chosen now. */
  usable: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListAppointmentTemplatesQuery = z.infer<typeof listAppointmentTemplatesQuerySchema>;

export const appointmentTemplatesResponseSchema = z.object({
  data: z.array(appointmentTemplateSchema),
});
export type AppointmentTemplatesResponse = z.infer<typeof appointmentTemplatesResponseSchema>;

/** One entry of the built-in set, with the library message that was made from it (if any). */
export const predefinedAppointmentTemplateSchema = z.object({
  key: z.string(),
  kind: appointmentMessageKindSchema,
  channel: appointmentTemplateChannelSchema,
  language: z.string(),
  name: z.string(),
  subject: z.string().nullable(),
  body: z.string(),
  variables: z.array(z.string()),
  /** The Meta category a WhatsApp message is submitted under. */
  metaCategory: z.enum(['UTILITY', 'MARKETING']).nullable(),
  adoptedId: uuidSchema.nullable(),
});
export type PredefinedAppointmentTemplate = z.infer<typeof predefinedAppointmentTemplateSchema>;

export const predefinedAppointmentTemplatesResponseSchema = z.object({
  data: z.array(predefinedAppointmentTemplateSchema),
  /** The placeholders a message can use, and the ones a WhatsApp message can use (in the order WhatsApp fills them). */
  placeholders: z.array(z.string()),
  whatsappPlaceholders: z.array(z.string()),
});
export type PredefinedAppointmentTemplatesResponse = z.infer<
  typeof predefinedAppointmentTemplatesResponseSchema
>;

/** Adopt a built-in message: an email lands in the library at once; a WhatsApp one is created as a template (a draft, or sent to Meta). */
export const adoptAppointmentTemplateSchema = z.object({
  key: z.string().trim().min(1).max(80),
  channel: appointmentTemplateChannelSchema,
  language: appointmentTemplateLanguageSchema.default('en'),
  /** WhatsApp: the number to submit through; left out = the channel's default sender. */
  connectionId: uuidSchema.optional(),
  /** WhatsApp: send it to Meta for review now (default: keep it as a draft to read first). */
  submit: z.boolean().default(false),
});
export type AdoptAppointmentTemplateInput = z.infer<typeof adoptAppointmentTemplateSchema>;

/** The owner's own email message (a WhatsApp message always starts from a built-in one or from the template library). */
export const createAppointmentTemplateSchema = z.object({
  kind: appointmentMessageKindSchema,
  channel: z.literal('email'),
  language: appointmentTemplateLanguageSchema.default('en'),
  name: z.string().trim().min(1).max(APPOINTMENT_TEMPLATE_NAME_MAX),
  subject: z.string().trim().max(APPOINTMENT_TEMPLATE_SUBJECT_MAX).nullish(),
  body: z.string().trim().min(1).max(APPOINTMENT_TEMPLATE_BODY_MAX),
});
export type CreateAppointmentTemplateInput = z.infer<typeof createAppointmentTemplateSchema>;

export const updateAppointmentTemplateSchema = z.object({
  name: z.string().trim().min(1).max(APPOINTMENT_TEMPLATE_NAME_MAX).optional(),
  subject: z.string().trim().max(APPOINTMENT_TEMPLATE_SUBJECT_MAX).nullish(),
  body: z.string().trim().min(1).max(APPOINTMENT_TEMPLATE_BODY_MAX).optional(),
  isActive: z.boolean().optional(),
  /** WhatsApp: after changing the text, send it to Meta again. */
  submit: z.boolean().default(false),
  rowVersion: z.number().int(),
});
export type UpdateAppointmentTemplateInput = z.infer<typeof updateAppointmentTemplateSchema>;

export const appointmentTemplateResultSchema = z.object({
  template: appointmentTemplateSchema,
  /** Set when Meta refused the submission: its words (the message is kept). */
  metaError: z.string().nullable(),
});
export type AppointmentTemplateResult = z.infer<typeof appointmentTemplateResultSchema>;
