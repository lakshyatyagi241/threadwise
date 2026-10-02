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
import type {
  ChannelCapabilities,
  ChannelKind,
  ChannelSettings,
  MessageMediaKind,
  ReceiptStatus,
} from '@crm/contracts';

/** A channel as an adapter sees it. Credentials are opened by the registry and handed over for this call only. */
export interface ChannelRuntime {
  orgId: number;
  uuid: string;
  kind: string;
  status: 'connected' | 'disconnected' | 'error';
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
    }),
  }),
  z.object({
    ...common,
    kind: z.literal('template'),
    template: z.object({
      name: z.string().trim().min(1).max(512),
      language: z.string().trim().min(2).max(16),
      variables: z.record(z.string()).default({}),
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
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ChannelError';
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
  /** Whether a provider posts to `/v2/webhooks/channels/:uuid` for this kind (and so a verify token and a URL exist). */
  readonly publicWebhook: boolean;
  /** Shape of the credentials a channel of this kind takes; null when it takes none. */
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
  ): boolean;

  /** Maps a verified webhook payload (messages and delivery receipts) into the normalised shapes. Never throws on an unknown shape. */
  parseInbound(channel: ChannelRuntime, payload: unknown): ParsedInbound;

  fetchMedia?(
    channel: ChannelRuntime,
    media: InboundMedia,
  ): Promise<{ bytes: Buffer; mime: string }>;
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
