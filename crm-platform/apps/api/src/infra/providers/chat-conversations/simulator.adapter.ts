import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  SIMULATOR_DEFAULTS,
  messageMediaKindSchema,
  receiptStatusSchema,
  type ChannelCapabilities,
  type SimulatorInboundInput,
  type SimulatorReceiptInput,
  type SimulatorSettings,
} from '@crm/contracts';
import { chatConversationsConfig } from '../../../config/domains/chat-conversations.env';
import {
  ChannelError,
  windowFromLastInbound,
  type ChannelAdapter,
  type ChannelRuntime,
  type InboundMedia,
  type NormalisedInbound,
  type OutboundEnvelope,
  type ParsedInbound,
  type PlannedReceipt,
  type SendResult,
  type WindowInfo,
} from './channel.port';

/**
 * Outbound faults, chosen by a prefix on the message body (or the media caption), so a tester can provoke each failure from the
 * composer or from the dev panel without any server state:
 *
 *   /fail   the provider refuses the message for good (`SIM_REJECTED`, not retryable): the message ends `failed`, Retry shows.
 *   /flaky  a retryable error on the first two attempts, success on the third: the queue's backoff and retry path.
 *   /slow   the provider takes `slowMs` (10 s) to answer: timeouts and the in-flight state.
 *   /ooo    the receipts arrive out of order (read, then delivered, then sent): the status must never move backwards.
 */
export type SimulatorFault = 'fail' | 'flaky' | 'slow' | 'ooo';

const OUTBOUND_FAULT = /^\/(fail|flaky|slow|ooo)(?:\s|$)/i;
const INBOUND_DUP = /^\/dup(?:\s+|$)/i;

export function outboundFault(text: string | undefined): SimulatorFault | null {
  const m = OUTBOUND_FAULT.exec((text ?? '').trimStart());
  return m ? (m[1]!.toLowerCase() as SimulatorFault) : null;
}

/** `/dup <text>` on an inbound message asks for three deliveries of it; the text is what follows. */
export function inboundDup(text: string | undefined): { dup: boolean; text: string | undefined } {
  const t = (text ?? '').trimStart();
  return INBOUND_DUP.test(t)
    ? { dup: true, text: t.replace(INBOUND_DUP, '') || undefined }
    : { dup: false, text };
}

const SIMULATOR_CAPABILITIES: ChannelCapabilities = {
  // A WhatsApp-like profile so the screens built against the simulator have the real shape.
  windowHours: 24,
  templates: true,
  media: ['image', 'video', 'audio', 'document', 'location'],
  reactions: true,
  editDelete: false,
  receipts: ['sent', 'delivered', 'read'],
  typing: true,
};

const payloadSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string(),
        from: z.string(),
        name: z.string().optional(),
        kind: z.enum(['text', 'media', 'location']),
        text: z.string().optional(),
        media: z
          .object({
            mediaKind: messageMediaKindSchema.exclude(['location', 'contact']),
            mime: z.string(),
            name: z.string().optional(),
            sizeBytes: z.number().optional(),
          })
          .optional(),
        location: z
          .object({
            latitude: z.number(),
            longitude: z.number(),
            name: z.string().optional(),
            address: z.string().optional(),
          })
          .optional(),
        sentAt: z.string().datetime(),
      }),
    )
    .default([]),
  receipts: z
    .array(
      z.object({
        id: z.string(),
        status: receiptStatusSchema,
        at: z.string().datetime(),
        errorCode: z.string().optional(),
        errorMessage: z.string().optional(),
      }),
    )
    .default([]),
});

// A 1x1 transparent PNG: what a simulated image "downloads" as.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The built-in channel for development and tests (`kind: 'simulator'`): it behaves like a WhatsApp-style provider with nothing on the
 * other end, so the whole inbox can be built and tested without a real account.
 *
 * It exists only outside production. The constructor refuses to build in a production environment, the provider module does not bind
 * it there, and the boot check stops a production process that asks for it. It is never reachable from `/webhooks`
 * (`verifyInbound` is always false): messages come in through the dev routes, which hand the same normalised shape to the same ingest
 * queue a real webhook would.
 */
export class SimulatorAdapter implements ChannelAdapter {
  readonly kind = 'simulator' as const;
  readonly live = true;
  readonly publicWebhook = false;
  readonly credentialsSchema = null;
  readonly secretFields = [] as const;

  private readonly slowMs: number;

  constructor(opts: { slowMs?: number; env?: NodeJS.ProcessEnv } = {}) {
    if (chatConversationsConfig(opts.env).production) {
      throw new Error('The channel simulator cannot be created in a production environment.');
    }
    this.slowMs = opts.slowMs ?? 10_000;
  }

  externalIdOf(): string | null {
    return null;
  }

  capabilities(): ChannelCapabilities {
    return { ...SIMULATOR_CAPABILITIES, media: [...SIMULATOR_CAPABILITIES.media] };
  }

  windowInfo(channel: ChannelRuntime, lastInboundAt: Date | null, now: Date): WindowInfo {
    const mode = this.settings(channel).window;
    const hours = SIMULATOR_CAPABILITIES.windowHours;
    const natural = windowFromLastInbound(hours, lastInboundAt, now);
    if (mode === 'open') return { open: true, expiresAt: natural.expiresAt };
    if (mode === 'closed') return { open: false, expiresAt: natural.expiresAt };
    return natural;
  }

  async send(channel: ChannelRuntime, envelope: OutboundEnvelope): Promise<SendResult> {
    const text =
      envelope.kind === 'text'
        ? envelope.body
        : envelope.kind === 'media'
          ? envelope.media.caption
          : undefined;
    const fault = outboundFault(text);

    if (fault === 'fail') {
      throw new ChannelError('SIM_REJECTED', 'The simulated provider rejected this message', false);
    }
    if (fault === 'flaky' && envelope.attempt <= 2) {
      throw new ChannelError(
        'SIM_FLAKY',
        `The simulated provider is having a bad moment (attempt ${envelope.attempt})`,
        true,
      );
    }
    if (fault === 'slow') await sleep(this.slowMs);

    // Derived from the client reference, so a repeated send of one message gets the same id, like a provider that dedupes.
    const providerMessageId = `sim.${createHash('sha1').update(`${channel.uuid}:${envelope.clientReference}`).digest('hex').slice(0, 24)}`;
    return {
      providerMessageId,
      acceptedAt: new Date(),
      plannedReceipts: this.receiptPlan(this.settings(channel), fault === 'ooo'),
    };
  }

  /** Never: the simulator has no public webhook. Its messages come through the authenticated dev routes. */
  verifyInbound(): boolean {
    return false;
  }

  parseInbound(_channel: ChannelRuntime, payload: unknown): ParsedInbound {
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return { messages: [], receipts: [] };
    return {
      messages: parsed.data.messages.map((m): NormalisedInbound => {
        const base = {
          providerMessageId: m.id,
          peerKey: m.from,
          peerName: m.name,
          providerTimestamp: new Date(m.sentAt),
        };
        if (m.kind === 'media' && m.media) {
          return {
            ...base,
            kind: 'media',
            body: m.text,
            media: {
              providerMediaId: `${m.id}.media`,
              mediaKind: m.media.mediaKind,
              mime: m.media.mime,
              name: m.media.name,
              sizeBytes: m.media.sizeBytes,
            },
          };
        }
        if (m.kind === 'location' && m.location) {
          return { ...base, kind: 'location', location: m.location };
        }
        return { ...base, kind: 'text', body: m.text };
      }),
      receipts: parsed.data.receipts.map((r) => ({
        providerMessageId: r.id,
        status: r.status,
        at: new Date(r.at),
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
      })),
    };
  }

  async fetchMedia(
    _channel: ChannelRuntime,
    media: InboundMedia,
  ): Promise<{ bytes: Buffer; mime: string }> {
    if (media.mediaKind === 'image' || media.mediaKind === 'sticker') {
      return { bytes: PIXEL, mime: 'image/png' };
    }
    return {
      bytes: Buffer.from(`Simulated ${media.mediaKind} ${media.name ?? media.providerMediaId}\n`),
      mime: 'text/plain',
    };
  }

  // --- what the dev routes need: the payloads a "webhook" would carry --------------------------------------------------------

  /** The payload of one customer message, in the shape `parseInbound` reads. A `/dup ` text prefix is stripped here. */
  static inboundPayload(
    input: SimulatorInboundInput,
    now: Date = new Date(),
  ): { id: string; payload: unknown } {
    const id = input.providerMessageId ?? `sim.in.${randomUUID()}`;
    const { text } = inboundDup(input.text);
    return {
      id,
      payload: {
        messages: [
          {
            id,
            from: input.from,
            name: input.name,
            kind: input.kind,
            text,
            media: input.media,
            location: input.location,
            sentAt: input.sentAt ?? now.toISOString(),
          },
        ],
      },
    };
  }

  /** True when this inbound asks to be delivered three times (a `/dup ` text prefix or `fault: 'dup'`). */
  static wantsDuplicateDelivery(input: SimulatorInboundInput): boolean {
    return input.fault === 'dup' || inboundDup(input.text).dup;
  }

  static receiptPayload(input: SimulatorReceiptInput, now: Date = new Date()): unknown {
    return {
      receipts: [
        {
          id: input.providerMessageId,
          status: input.status,
          at: now.toISOString(),
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
        },
      ],
    };
  }

  // --- internals ---------------------------------------------------------------------------------------------------------------

  private settings(channel: ChannelRuntime): SimulatorSettings {
    const s = channel.settings.simulator;
    return {
      latencyMs: { ...SIMULATOR_DEFAULTS.latencyMs, ...s?.latencyMs },
      window: s?.window ?? SIMULATOR_DEFAULTS.window,
    };
  }

  private receiptPlan(s: SimulatorSettings, outOfOrder: boolean): PlannedReceipt[] {
    if (!outOfOrder) {
      return [
        { status: 'sent', delayMs: s.latencyMs.sent },
        { status: 'delivered', delayMs: s.latencyMs.delivered },
        { status: 'read', delayMs: s.latencyMs.read },
      ];
    }
    // Reversed on purpose, a few hundred milliseconds apart so the order of arrival is deterministic.
    const t = s.latencyMs.sent;
    return [
      { status: 'read', delayMs: t },
      { status: 'delivered', delayMs: t + 500 },
      { status: 'sent', delayMs: t + 1_000 },
    ];
  }
}
