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
export const CHANNEL_KINDS = ['simulator', 'whatsapp_cloud', 'webchat', 'telegram'] as const;
export const channelKindSchema = z.enum(CHANNEL_KINDS);
export type ChannelKind = z.infer<typeof channelKindSchema>;

/**
 * `needs_reauth` is `error` with a known cure: the provider no longer accepts the credentials (an expired or revoked token), so a
 * person must paste a new one. Set by the system only, like `error`.
 */
export const channelStatusSchema = z.enum(['connected', 'disconnected', 'error', 'needs_reauth']);
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

// --- health -------------------------------------------------------------------------------------------------------------

export const channelHealthIssueSchema = z.object({
  severity: z.enum(['critical', 'warning', 'info']),
  /** Stable, for the web to translate: `TOKEN_INVALID`, `TOKEN_EXPIRING`, `NO_WEBHOOK_SUBSCRIPTION`, `QUALITY_RED`, ... */
  code: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
});
export type ChannelHealthIssue = z.infer<typeof channelHealthIssueSchema>;

/**
 * What the last health check found, stored on the channel and returned by `POST /channels/:id/health`. Built from live reads of
 * the provider (for WhatsApp: the phone number node, the account node, the app's subscription and, with an app id, the token).
 * One failing read never blanks the rest; what could not be read is in `issues`.
 */
export const channelHealthSchema = z.object({
  /** The number is reachable with the stored token and the provider reports it usable. */
  ok: z.boolean(),
  /** blocked: a critical issue; attention: a warning; healthy otherwise. */
  overall: z.enum(['healthy', 'attention', 'blocked']),
  checkedAt: z.string().datetime(),
  /** The name Meta verified for the number. */
  displayName: z.string().nullable(),
  displayPhoneNumber: z.string().nullable(),
  /** Meta's `quality_rating`: GREEN, YELLOW, RED, UNKNOWN. */
  qualityRating: z.string().nullable(),
  /** Meta's `messaging_limit_tier` (TIER_250, TIER_1K, ..., TIER_UNLIMITED). */
  messagingLimitTier: z.string().nullable(),
  /** Meta's number `status`: CONNECTED, PENDING, FLAGGED, RESTRICTED, ... */
  phoneStatus: z.string().nullable(),
  codeVerificationStatus: z.string().nullable(),
  nameStatus: z.string().nullable(),
  platformType: z.string().nullable(),
  token: z.object({
    /** null: not asked (no app id stored), or the read failed. */
    valid: z.boolean().nullable(),
    expiresAt: z.string().datetime().nullable(),
    scopes: z.array(z.string()).nullable(),
  }),
  webhook: z.object({
    /** Whether the app is subscribed to the account's webhooks; null when it could not be read (no account id, or a failed read). */
    subscribed: z.boolean().nullable(),
  }),
  issues: z.array(channelHealthIssueSchema),
  /** The first thing that stopped the number being usable, in our vocabulary (a problem+json code or a Meta error code). */
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type ChannelHealth = z.infer<typeof channelHealthSchema>;

/** The last failure the system recorded on a channel: a send the provider refused for credentials, or a failed health check. */
export const channelLastErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  at: z.string().datetime(),
});
export type ChannelLastError = z.infer<typeof channelLastErrorSchema>;

/** `POST /channels/:id/health`: the snapshot, plus the channel's status after it (a token Meta refused moves it to `needs_reauth`). */
export const channelHealthResponseSchema = channelHealthSchema.extend({
  status: channelStatusSchema,
  /** The channel's version after the check wrote its snapshot: the next PATCH must send this one, not the one read before. */
  rowVersion: z.number().int(),
});
export type ChannelHealthResponse = z.infer<typeof channelHealthResponseSchema>;

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
  /** The provider's account id when it has one (WhatsApp: the WABA id). Not a secret. */
  businessAccountId: z.string().nullable().optional(),
  hasCredentials: z.boolean(),
  /** Last four characters of each stored secret, for recognising which token is connected. */
  credentialHints: z.record(z.string()),
  /** The last health check (null: never run). Always sent by the API; optional only so a fixture built before it still parses. */
  health: channelHealthSchema.nullable().optional(),
  /** Why the system last stopped trusting the channel; cleared when it is switched on again. */
  lastError: channelLastErrorSchema.nullable().optional(),
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

// --- requests -----------------------------------------------------------------------------------------------------------

const channelName = z.string().trim().min(1).max(120);

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
