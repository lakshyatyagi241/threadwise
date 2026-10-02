import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * chat-conversations: the channel registry (plan-inbox-chat.md sections 3.2 and 3.3).
 *
 * A channel is one connected way of talking to customers. Credentials go in and never come back: responses carry a `hasCredentials`
 * flag and the last four characters of each secret, nothing more. The webhook verify token is shown once, on create and on rotate.
 */

// --- vocabulary ---------------------------------------------------------------------------------------------------------

/** Adapter families. A new channel type is a new member here and a new adapter; the database stores the plain string. */
export const CHANNEL_KINDS = ['simulator', 'whatsapp_cloud', 'whatsapp_qr', 'whatsapp_waba', 'webchat'] as const;
export const channelKindSchema = z.enum(CHANNEL_KINDS);
export type ChannelKind = z.infer<typeof channelKindSchema>;

export const channelStatusSchema = z.enum(['connected', 'disconnected', 'error']);
export type ChannelStatus = z.infer<typeof channelStatusSchema>;

export const messageMediaKindSchema = z.enum([
  'image',
  'video',
  'audio',
  'document',
  'sticker',
  'location',
  'contact',
]);
export type MessageMediaKind = z.infer<typeof messageMediaKindSchema>;

/** The delivery steps a provider reports, in the order a message moves through them. */
export const receiptStatusSchema = z.enum(['sent', 'delivered', 'read', 'failed']);
export type ReceiptStatus = z.infer<typeof receiptStatusSchema>;

export const channelCapabilitiesSchema = z.object({
  /** Free-form replies are allowed this many hours after the customer's last message; null = no window rule. */
  windowHours: z.number().int().positive().nullable(),
  templates: z.boolean(),
  media: z.array(messageMediaKindSchema),
  reactions: z.boolean(),
  /** Edit and delete-for-everyone (unofficial WhatsApp engines only). */
  editDelete: z.boolean(),
  receipts: z.array(z.enum(['sent', 'delivered', 'read'])),
  typing: z.boolean(),
});
export type ChannelCapabilities = z.infer<typeof channelCapabilitiesSchema>;

// --- settings -----------------------------------------------------------------------------------------------------------

export const SIMULATOR_LATENCY_MAX_MS = 60_000;
const latencyMs = z.number().int().min(0).max(SIMULATOR_LATENCY_MAX_MS);

export const simulatorSettingsSchema = z
  .object({
    /** When the simulated provider reports each step after accepting a send. */
    latencyMs: z.object({ sent: latencyMs, delivered: latencyMs, read: latencyMs }),
    /** auto: the 24 hour rule from the customer's last message. open / closed force the answer (to exercise the template-only screen). */
    window: z.enum(['auto', 'open', 'closed']),
  })
  .strict();
export type SimulatorSettings = z.infer<typeof simulatorSettingsSchema>;

export const SIMULATOR_DEFAULTS: SimulatorSettings = {
  latencyMs: { sent: 0, delivered: 1_000, read: 3_000 },
  window: 'auto',
};

export const channelSettingsSchema = z
  .object({
    /** false: sends through this channel never count toward the plan's monthly messages and never charge the wallet. */
    metered: z.boolean(),
    simulator: simulatorSettingsSchema.optional(),
  })
  .strict();
export type ChannelSettings = z.infer<typeof channelSettingsSchema>;

/** What a client may change; omitted keys keep their value (the nested simulator object is merged one level down). */
export const channelSettingsPatchSchema = z
  .object({
    metered: z.boolean(),
    simulator: z
      .object({
        latencyMs: z
          .object({ sent: latencyMs, delivered: latencyMs, read: latencyMs })
          .partial()
          .strict(),
        window: z.enum(['auto', 'open', 'closed']),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();
export type ChannelSettingsPatch = z.infer<typeof channelSettingsPatchSchema>;

// --- credentials (write only) -------------------------------------------------------------------------------------------

export const whatsappCloudCredentialsSchema = z
  .object({
    /** Meta's phone number id: the sender in every send. */
    phoneNumberId: z
      .string()
      .trim()
      .regex(/^\d{5,32}$/, 'Digits only'),
    accessToken: z.string().trim().min(10).max(2048),
    /** Signs every webhook delivery (X-Hub-Signature-256). */
    appSecret: z.string().trim().min(8).max(256),
    businessAccountId: z
      .string()
      .trim()
      .regex(/^\d{5,32}$/, 'Digits only')
      .optional(),
  })
  .strict();
export type WhatsappCloudCredentials = z.infer<typeof whatsappCloudCredentialsSchema>;

// --- responses ----------------------------------------------------------------------------------------------------------

export const channelResponseSchema = z.object({
  id: uuidSchema,
  kind: channelKindSchema,
  name: z.string(),
  status: channelStatusSchema,
  /** The provider's handle for the account (WhatsApp phone number id). */
  externalId: z.string().nullable(),
  /** What a person recognises it by (the phone number). */
  displayAddress: z.string().nullable(),
  /** What the adapter reports plus this channel's overrides. */
  capabilities: channelCapabilitiesSchema,
  settings: channelSettingsSchema,
  hasCredentials: z.boolean(),
  /** Last four characters of each stored secret, for recognising which token is connected. */
  credentialHints: z.record(z.string()),
  /** Where the provider posts (absolute). Null for a channel no provider can reach (the simulator). */
  webhookUrl: z.string().nullable(),
  lastEventAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type ChannelResponse = z.infer<typeof channelResponseSchema>;

export const channelListResponseSchema = z.object({ data: z.array(channelResponseSchema) });
export type ChannelListResponse = z.infer<typeof channelListResponseSchema>;

/** Returned once, by create and by rotate: the value the provider's verification challenge must echo. */
export const channelWebhookRevealSchema = channelResponseSchema.extend({
  webhookVerifyToken: z.string(),
});
export type ChannelWebhookReveal = z.infer<typeof channelWebhookRevealSchema>;

// --- requests -----------------------------------------------------------------------------------------------------------

const channelName = z.string().trim().min(1).max(120);

/** A real provider channel. The union grows with the adapters: one member per kind that takes credentials. */
export const createChannelSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('whatsapp_cloud'),
    name: channelName,
    credentials: whatsappCloudCredentialsSchema,
    /** The number as people write it, shown in the list ("+91 98765 43210"). */
    displayAddress: z.string().trim().min(1).max(40).optional(),
    settings: channelSettingsPatchSchema.optional(),
  }),
]);
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

/** The dev-only simulated channel: no credentials, never reachable from outside. */
export const createSimulatorChannelSchema = z.object({
  name: channelName.default('Simulator'),
  settings: channelSettingsPatchSchema.optional(),
});
export type CreateSimulatorChannelInput = z.infer<typeof createSimulatorChannelSchema>;

export const updateChannelSchema = z
  .object({
    rowVersion: z.number().int().positive(),
    name: channelName.optional(),
    /** A person can switch a channel on or off; `error` is only ever set by the system. */
    status: z.enum(['connected', 'disconnected']).optional(),
    settings: channelSettingsPatchSchema.optional(),
    /** Rotating credentials: only the keys sent are replaced. */
    credentials: whatsappCloudCredentialsSchema.partial().optional(),
    displayAddress: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'rowVersion'), {
    message: 'Nothing to update',
  });
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

// --- dev simulator ------------------------------------------------------------------------------------------------------

export const SIMULATOR_INBOUND_TEXT_MAX = 4096;

/**
 * One message from the pretend customer. It is turned into the same normalised shape a real webhook produces and queued on the
 * ingest queue, so the whole pipeline is exercised, not bypassed. A text starting with `/dup ` (or `fault: 'dup'`) is delivered
 * three times under one provider id, to prove the pipeline stores it once.
 */
export const simulatorInboundSchema = z
  .object({
    /** The customer's number, digits only (the peer key). */
    from: z
      .string()
      .trim()
      .regex(/^\d{5,15}$/, 'Digits only, 5 to 15'),
    name: z.string().trim().min(1).max(120).optional(),
    kind: z.enum(['text', 'media', 'location']).default('text'),
    text: z.string().max(SIMULATOR_INBOUND_TEXT_MAX).optional(),
    media: z
      .object({
        mediaKind: messageMediaKindSchema.exclude(['location', 'contact']),
        mime: z.string().trim().min(3).max(127),
        name: z.string().trim().max(255).optional(),
        sizeBytes: z.number().int().nonnegative().optional(),
      })
      .optional(),
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        name: z.string().trim().max(255).optional(),
        address: z.string().trim().max(500).optional(),
      })
      .optional(),
    providerMessageId: z.string().trim().min(1).max(128).optional(),
    fault: z.enum(['dup']).optional(),
    /** When the customer "sent" it; defaults to now. */
    sentAt: z.string().datetime().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'text' && !v.text?.trim())
      ctx.addIssue({ code: 'custom', path: ['text'], message: 'A text message needs text' });
    if (v.kind === 'media' && !v.media)
      ctx.addIssue({ code: 'custom', path: ['media'], message: 'A media message needs media' });
    if (v.kind === 'location' && !v.location)
      ctx.addIssue({
        code: 'custom',
        path: ['location'],
        message: 'A location message needs a location',
      });
  });
export type SimulatorInboundInput = z.infer<typeof simulatorInboundSchema>;

export const simulatorInboundResponseSchema = z.object({
  providerMessageId: z.string(),
  /** How many times the same message was queued (3 for a duplicate delivery). */
  deliveries: z.number().int().positive(),
});
export type SimulatorInboundResponse = z.infer<typeof simulatorInboundResponseSchema>;

/** A delivery step for a message the simulated provider "accepted", sent whenever the tester likes (out of order too). */
export const simulatorReceiptSchema = z.object({
  providerMessageId: z.string().trim().min(1).max(128),
  status: receiptStatusSchema,
  errorCode: z.string().trim().max(64).optional(),
  errorMessage: z.string().trim().max(500).optional(),
  delayMs: z.number().int().min(0).max(SIMULATOR_LATENCY_MAX_MS).default(0),
});
export type SimulatorReceiptInput = z.infer<typeof simulatorReceiptSchema>;

export const simulatorReceiptResponseSchema = z.object({ queued: z.literal(true) });
export type SimulatorReceiptResponse = z.infer<typeof simulatorReceiptResponseSchema>;
