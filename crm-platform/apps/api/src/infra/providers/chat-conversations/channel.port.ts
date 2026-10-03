/**
 * The channel port: what the conversation core needs from anything that carries messages to customers (the dev simulator, WhatsApp
 * Cloud, a web chat widget, later an unofficial WhatsApp engine). Everything above this interface is written against it, so a new
 * channel is one adapter and a `kind`, not a change to the send pipeline.
 *
 * The pre-send guard (emergency halt, content screen), the plan cap and the 24 hour rule are NOT here: they live once in the
 * `ChannelDispatcher`, so every adapter is covered without each one remembering to call them.
 *
 * Normalise at the boundary: an adapter maps its vendor's shape into the types below and nothing vendor-specific leaks past it.
 */
import { z } from 'zod';
import type { InboundMediaFetcher } from '../whatsapp/media/inbound-media-fetcher.port';
import type {
  ChannelCapabilities,
  ChannelHealth,
  ChannelKind,
  ChannelSettings,
  ChannelStatus,
  MessageMediaKind,
  ReceiptStatus,
} from '@crm/contracts';

/** A channel as an adapter sees it. Credentials are opened by the registry and handed over for this call only. */
export interface ChannelRuntime {
  orgId: number;
  uuid: string;
  kind: string;
  status: ChannelStatus;
  externalId: string | null;
  displayAddress: string | null;
  settings: ChannelSettings;
  /** Per-channel overrides of `capabilities()`; already merged by the registry, kept for adapters that care. */
  capabilityOverrides: Partial<ChannelCapabilities>;
  /** Opened credentials. Empty for a kind that takes none, and never logged. */
  credentials: Readonly<Record<string, string | undefined>>;
}

// --- outbound -----------------------------------------------------------------------------------------------------------

const common = {
  /** The peer on the channel (digits for a phone channel). */
  to: z.string().trim().min(1).max(128),
  /**
   * Correlates a provider's async receipts, and a retried send, with our message row. Stable across retries of one message: it is
   * the idempotency key of the send.
   */
  clientReference: z.string().trim().min(1).max(128),
  /** 1 on the first try, +1 per retry. Lets a simulated fault depend on the attempt without keeping state. */
  attempt: z.number().int().min(1).default(1),
  replyToProviderMessageId: z.string().trim().min(1).max(128).optional(),
};

export const OUTBOUND_TEXT_MAX = 4096;
export const OUTBOUND_CAPTION_MAX = 1024;

export const outboundEnvelopeSchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('text'),
    body: z.string().min(1).max(OUTBOUND_TEXT_MAX),
    /** Ask the provider to render a link preview (WhatsApp `preview_url`). */
    previewUrl: z.boolean().optional(),
  }),
  z.object({
    ...common,
    kind: z.literal('media'),
    media: z.object({
      /** The object-store key (never a URL: the adapter asks the media store for bytes or a short-lived link). */
      key: z.string().trim().min(1).max(512),
      mediaKind: z.enum(['image', 'video', 'audio', 'document', 'sticker']),
      mime: z.string().trim().min(3).max(127),
      name: z.string().trim().max(255).optional(),
      caption: z.string().max(OUTBOUND_CAPTION_MAX).optional(),
      /** The file's sha256 (lower-case hex) when the caller has it: the key a provider's uploaded-media cache is kept under. */
      sha256: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
    }),
  }),
  z.object({
    ...common,
    kind: z.literal('template'),
    template: z.object({
      name: z.string().trim().min(1).max(512),
      language: z.string().trim().min(2).max(16),
      variables: z.record(z.string()).default({}),
      /**
       * The provider's own component list for this recipient (header media, buttons, carousel), already built by whoever owns the
       * template library. When set it is sent as it is and `variables` is ignored.
       */
      components: z.array(z.record(z.unknown())).optional(),
    }),
  }),
  z.object({
    ...common,
    kind: z.literal('reaction'),
    reaction: z.object({
      providerMessageId: z.string().trim().min(1).max(128),
      /** An empty string removes the reaction. */
      emoji: z.string().max(16),
    }),
  }),
  z.object({
    ...common,
    kind: z.literal('contacts'),
    /** One or more contact cards (WhatsApp `contacts` message). */
    contacts: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          phones: z
            .array(
              z.object({
                phone: z.string().trim().min(3).max(32),
                type: z.string().max(16).optional(),
              }),
            )
            .max(5)
            .default([]),
          emails: z.array(z.string().trim().min(3).max(254)).max(5).default([]),
          org: z.string().trim().max(200).optional(),
        }),
      )
      .min(1)
      .max(10),
  }),
  z.object({
    ...common,
    kind: z.literal('interactive'),
    interactive: z.discriminatedUnion('type', [
      z.object({
        /** Up to three reply buttons. */
        type: z.literal('buttons'),
        body: z.string().min(1).max(1024),
        header: z.string().max(60).optional(),
        footer: z.string().max(60).optional(),
        buttons: z
          .array(z.object({ id: z.string().min(1).max(256), title: z.string().min(1).max(20) }))
          .min(1)
          .max(3),
      }),
      z.object({
        /** A list of up to ten rows in sections, opened by one button. */
        type: z.literal('list'),
        body: z.string().min(1).max(1024),
        header: z.string().max(60).optional(),
        footer: z.string().max(60).optional(),
        button: z.string().min(1).max(20),
        sections: z
          .array(
            z.object({
              title: z.string().max(24).optional(),
              rows: z
                .array(
                  z.object({
                    id: z.string().min(1).max(200),
                    title: z.string().min(1).max(24),
                    description: z.string().max(72).optional(),
                  }),
                )
                .min(1)
                .max(10),
            }),
          )
          .min(1)
          .max(10),
      }),
      z.object({
        /** One button that opens a link. */
        type: z.literal('cta_url'),
        body: z.string().min(1).max(1024),
        header: z.string().max(60).optional(),
        footer: z.string().max(60).optional(),
        text: z.string().min(1).max(20),
        url: z.string().url().max(2000),
      }),
      z.object({
        /** A WhatsApp Form (a Meta flow message): the published form behind `flowId`, opened by one button. */
        type: z.literal('flow'),
        body: z.string().min(1).max(1024),
        header: z.string().max(60).optional(),
        footer: z.string().max(60).optional(),
        flowId: z.string().trim().min(1).max(64),
        /** Comes back on the submission, which is how it finds the run that sent the form. */
        flowToken: z.string().trim().min(1).max(256),
        cta: z.string().min(1).max(20),
      }),
    ]),
  }),
  z.object({
    ...common,
    kind: z.literal('location'),
    location: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      name: z.string().trim().max(255).optional(),
      address: z.string().trim().max(500).optional(),
    }),
  }),
]);
/** What a pipeline hands the dispatcher. Parse with `outboundEnvelopeSchema` to apply the `attempt` default. */
export type OutboundEnvelope = z.infer<typeof outboundEnvelopeSchema>;

/** The text a content screen should look at for any kind of outbound message. */
export function envelopeText(e: OutboundEnvelope): string {
  switch (e.kind) {
    case 'text':
      return e.body;
    case 'media':
      return e.media.caption ?? '';
    case 'template':
      return Object.values(e.template.variables).join(' ');
    case 'location':
      return [e.location.name, e.location.address].filter(Boolean).join(' ');
    case 'contacts':
      return e.contacts.map((c) => c.name).join(' ');
    case 'interactive':
      return [e.interactive.body, e.interactive.footer].filter(Boolean).join(' ');
    case 'reaction':
      return '';
  }
}

/** A delivery step a simulated provider will report some time after accepting a send. Real providers use their webhook instead. */
export interface PlannedReceipt {
  status: ReceiptStatus;
  delayMs: number;
  errorCode?: string;
}

export interface SendResult {
  /** The provider's id for the message (a WhatsApp wamid). Stored on the message and in the ledger. */
  providerMessageId: string;
  acceptedAt: Date;
  /** Only the simulator fills this; the dispatcher turns it into delayed receipt jobs. */
  plannedReceipts?: PlannedReceipt[];
}

/**
 * A failed send. `retryable` decides what the worker does: rethrow to the queue (backoff, more attempts) or mark the message failed
 * and show the agent a Retry button. `code` is the provider's reason in our vocabulary (`131047` window closed for Meta,
 * `SIM_REJECTED` for the simulator), stored as the message's failure code.
 */
export class ChannelError extends Error {
  /** The provider cannot be used with the stored credentials until a person replaces them (an expired token): the channel is marked. */
  readonly needsReauth: boolean;
  /** The provider refused the PLATFORM's own credential (a BSP key): the customer cannot fix it, the channel goes to `error`. */
  readonly providerFault: boolean;
  /** For a retryable error: how long the provider asked us to wait (rate limits). The send queue's backoff honours it. */
  readonly retryAfterMs: number | null;
  /** The provider's own code, kept beside ours for the event log (`131047`). */
  readonly providerCode: string | null;

  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    options: {
      needsReauth?: boolean;
      providerFault?: boolean;
      retryAfterMs?: number | null;
      providerCode?: string | null;
    } = {},
  ) {
    super(message);
    this.name = 'ChannelError';
    this.needsReauth = options.needsReauth ?? false;
    this.providerFault = options.providerFault ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.providerCode = options.providerCode ?? null;
  }
}

// --- inbound ------------------------------------------------------------------------------------------------------------

export interface InboundMedia {
  /** The provider's id for the file; `fetchMedia` turns it into bytes. */
  providerMediaId: string;
  mediaKind: Exclude<MessageMediaKind, 'location' | 'contact'>;
  mime: string;
  name?: string;
  sizeBytes?: number;
  /** The digest the provider announced for the file: the fetched bytes are checked against it. */
  sha256?: string;
  /** A voice note (recorded in the app) rather than an audio file. */
  voice?: boolean;
}

export interface NormalisedInbound {
  providerMessageId: string;
  /** Who sent it on this channel: the thread key (digits for a phone channel). */
  peerKey: string;
  peerName?: string;
  kind: 'text' | 'media' | 'location' | 'contact' | 'reaction' | 'interactive' | 'unsupported';
  body?: string;
  media?: InboundMedia;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  /** The message a reaction or a reply points at. */
  replyToProviderMessageId?: string;
  reactionEmoji?: string;
  /**
   * What the channel knows beyond the common fields, stored on the message and read by the screens that render it: `contacts` (cards),
   * `interactive` (what the customer picked), `referral` (the ad or link that opened the chat), `rawType` (an unsupported kind),
   * `forwarded`. Plain JSON; the adapter keeps it small.
   */
  meta?: Record<string, unknown>;
  /** When the provider says the customer sent it. */
  providerTimestamp: Date;
}

export interface NormalisedReceipt {
  providerMessageId: string;
  status: ReceiptStatus;
  at: Date;
  errorCode?: string;
  errorMessage?: string;
}

export interface ParsedInbound {
  messages: NormalisedInbound[];
  receipts: NormalisedReceipt[];
  /** What the adapter saw and deliberately did not turn into a message or receipt (a group message, another number's change). For logs. */
  ignored?: Array<{ reason: string; detail?: string }>;
}

/** The answer of a provider health check. `needsReauth`: the provider refused the token itself (not a number problem). */
export interface ChannelHealthResult {
  health: ChannelHealth;
  needsReauth: boolean;
  /** The provider refused the platform's own credential (a BSP key): the customer cannot fix it. */
  providerFault: boolean;
}

// --- the 24 hour rule ----------------------------------------------------------------------------------------------------

export interface WindowInfo {
  /** Free-form (non-template) messages may be sent right now. */
  open: boolean;
  /** When it closes; null when it never does (no window rule) or there has been no customer message to anchor it. */
  expiresAt: Date | null;
}

/** The standard rule: open for `windowHours` after the customer's last message, closed before there is one. */
export function windowFromLastInbound(
  windowHours: number | null,
  lastInboundAt: Date | null,
  now: Date,
): WindowInfo {
  if (windowHours === null) return { open: true, expiresAt: null };
  if (!lastInboundAt) return { open: false, expiresAt: null };
  const expiresAt = new Date(lastInboundAt.getTime() + windowHours * 3_600_000);
  return { open: now.getTime() < expiresAt.getTime(), expiresAt };
}

// --- the port -----------------------------------------------------------------------------------------------------------

export interface ChannelAdapter {
  readonly kind: ChannelKind;
  /**
   * false: the adapter is a skeleton. A channel of this kind can be stored (credentials sealed, webhook token issued) but is never
   * `connected`, so nothing is sent through it, until the adapter goes live.
   */
  readonly live: boolean;
  /**
   * Whether a provider posts to `/v2/webhooks/channels/:uuid` for this kind (and so a verify token and a URL exist). False for a kind that
   * is received elsewhere: WhatsApp through the WABA domain's webhook, Telegram and the web chat widget through their own routes.
   */
  readonly publicWebhook: boolean;
  /** Shape of the credentials a channel of this kind takes; null when it takes none (WhatsApp: the connection's are used). */
  readonly credentialsSchema: z.ZodType<Record<string, string | undefined>> | null;
  /** Credential keys that are secrets: only their last four characters are ever shown back. */
  readonly secretFields: readonly string[];

  /** The provider's handle for the account, taken from the credentials (WhatsApp: the phone number id). */
  externalIdOf(credentials: Readonly<Record<string, string | undefined>>): string | null;

  capabilities(channel: ChannelRuntime): ChannelCapabilities;
  windowInfo(channel: ChannelRuntime, lastInboundAt: Date | null, now: Date): WindowInfo;

  /** Throws `ChannelError`. Called by the dispatcher only, after the guards. */
  send(channel: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult>;

  /**
   * Verifies a webhook delivery on the RAW body with this channel's secret. Returns false on any doubt. This is the only thing between
   * a public URL and someone writing messages into a customer's inbox: it is never skipped, never "dev mode".
   */
  verifyInbound(
    channel: ChannelRuntime,
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
  ): boolean | Promise<boolean>;

  /** Maps a verified webhook payload (messages and delivery receipts) into the normalised shapes. Never throws on an unknown shape. */
  parseInbound(channel: ChannelRuntime, payload: unknown): ParsedInbound;

  fetchMedia?(
    channel: ChannelRuntime,
    media: InboundMedia,
  ): Promise<{ bytes: Buffer; mime: string }>;

  /**
   * Present on a provider whose files must be copied in the background (WhatsApp Cloud: the id is a temporary handle, the download
   * can be large and can fail). When it is set, ingest stores the message at once without the file (`mediaState: 'pending'`) and a
   * `media-fetch` job calls it with retries; `fetchMedia` above is then not used. A provider with the inline `fetchMedia` (the
   * simulator, whose "download" is instant) keeps copying inside the ingest job.
   */
  readonly inboundMedia?: InboundMediaFetcher;

  /**
   * A live read of the provider account with the channel's credentials (for WhatsApp: its connection's). Never throws for a provider's
   * answer (a refused token is a result: `needsReauth`); throws `ChannelError` only when there is nothing to check with.
   */
  checkHealth?(channel: ChannelRuntime): Promise<ChannelHealthResult>;

  /** Tells the provider the customer's message was read (and, optionally, that an agent is typing). Throws `ChannelError`. */
  markRead?(
    channel: ChannelRuntime,
    providerMessageId: string,
    options?: { typing?: boolean },
  ): Promise<void>;
}

/** All adapters bound in this deployment, by `ChannelAdapter.kind`. */
export const CHANNEL_ADAPTERS = Symbol('CHANNEL_ADAPTERS');

/** Merges per-channel overrides over what the adapter reports. */
export function effectiveCapabilities(
  base: ChannelCapabilities,
  overrides: Partial<ChannelCapabilities>,
): ChannelCapabilities {
  return { ...base, ...overrides };
}
