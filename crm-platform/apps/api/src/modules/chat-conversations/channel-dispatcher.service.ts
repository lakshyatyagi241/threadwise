import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  ERROR_CODES,
  holdOf,
  purposeOf,
  type ConsentSubject,
  type PurposeInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import {
  ChannelError,
  envelopeText,
  outboundEnvelopeSchema,
  outboundTextMaxFor,
  type ChannelAdapter,
  type ChannelRuntime,
  type OutboundEnvelope,
  type PlannedReceipt,
  type WindowInfo,
} from '../../infra/providers/chat-conversations';
import {
  isGroupPeer,
  isGroupSendKind,
  isPersonalGroupSendKind,
} from '../../infra/providers/whatsapp/group-peer';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  OUTBOUND_SEND_GUARD,
  type OutboundSendGuard,
} from '../../infra/providers/whatsapp/send-guard.port';
import { SendWindowService, holdsPurpose } from '../compliance-center';
import { ConsentGate } from '../contact-consent';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { effectiveCapabilitiesOf } from './channel-capabilities';
import { ChannelIngestPublisher } from './channel-ingest.publisher';
import { SendHeldError } from './send-held.error';

/**
 * What the send IS, for the ConsentGate (BL-141). Required on every request, so a new caller cannot forget it: free-form replies and
 * utility templates are `service_messaging`, a MARKETING template or a promotional flow message is `marketing_messaging`.
 */
export interface DispatchConsent {
  purpose: PurposeInput;
  /** The contact (internal id) when the caller knows it. Without it the recipient key (a phone or an email) finds the contact. */
  contactId?: number | null;
}

/** What the caller knows about the send. */
export interface DispatchRequest {
  channel: ChannelRuntime;
  /** Parsed with `outboundEnvelopeSchema`; its `clientReference` is the idempotency key of the send. */
  envelope: unknown;
  /** The customer's last inbound message on this thread: the anchor of the 24 hour rule. */
  lastInboundAt: Date | null;
  /** Recorded with a flagged or blocked send: `inbox`, `broadcast`, ... */
  source?: string;
  consent: DispatchConsent;
}

export interface QueueCheckOptions {
  /**
   * Outbound messages this workspace has already sent this month, counted by the caller (it owns the message table). Omit it and the
   * plan cap is not checked here: that is for a caller that has no count.
   */
  monthlyUsed?: number;
  now?: Date;
}

export interface DispatchResult {
  providerMessageId: string;
  acceptedAt: Date;
  /** What a simulated provider will report later (empty for a real one, which uses its webhook). See `scheduleReceipts`. */
  plannedReceipts: PlannedReceipt[];
  /** What the adapter asked to record on the message's `meta` (see `SendResult.meta`). */
  meta?: Record<string, unknown>;
  /** True when this key had already been sent: the stored answer is returned and the provider is not called again. */
  replayed: boolean;
}

const RESULT_TTL_SECONDS = 24 * 3600;
/**
 * How long one worker owns a message's send. Long enough for a slow provider call, short enough that a worker killed mid-send does
 * not keep its message away from the retry for minutes (the queue's backoff comes back to it).
 */
const LOCK_TTL_SECONDS = 60;
const RELEASE_IF_OWNER =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * The one place a message passes before it reaches a channel adapter, so every adapter (the simulator, WhatsApp Cloud, whatever comes)
 * is covered once and none can forget a check.
 *
 * Two phases, because they run at different times:
 *
 *  - `assertCanQueue`, when an agent presses send (nothing is sent yet): the channel is connected, the channel can carry this kind of
 *    message, the 24 hour window is open for a free-form message, and the plan's monthly cap has room. Failing here is fast and
 *    visible: no row is created just to fail.
 *  - `send`, in the worker: the channel is still connected, the window is still open, the emergency halt and content screen
 *    (`OUTBOUND_SEND_GUARD`, which wraps the auth domain's SendPolicyService and EmergencyHaltService) pass, then the adapter is called
 *    once per `clientReference`. The halt is checked at send time, not only at enqueue time, so a halt stops what is already queued.
 *
 * Idempotency: a send that succeeded is remembered for 24 hours under its client reference; a retry (a redelivered job, a double
 * click) gets the stored answer and the provider is not called again. A failed send stores nothing, so a retry really retries; a send the provider accepted and then failed in a receipt is forgotten by `forget` when the agent presses Retry. The
 * residual window (the process dies after the provider accepted and before the answer is stored) is documented in
 * plan-inbox-chat.md section 3.4: the Cloud API has no idempotency key of its own.
 */
@Injectable()
export class ChannelDispatcher {
  private readonly logger = new Logger(ChannelDispatcher.name);

  constructor(
    private readonly adapters: ChannelAdapterRegistry,
    private readonly publisher: ChannelIngestPublisher,
    private readonly plans: PlanEntitlementService,
    @Inject(OUTBOUND_SEND_GUARD) private readonly guard: OutboundSendGuard,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly consentGate: ConsentGate,
    // Quiet hours (BL-177). Optional so a caller that builds the dispatcher without it keeps the old behaviour: nothing is held.
    @Optional() private readonly sendWindow?: SendWindowService,
  ) {}

  /**
   * The purpose of an envelope: a template takes its category (a MARKETING template is marketing), everything else a person writes or a
   * bot answers is a service message. `tx` is the caller's transaction when it has one.
   */
  async purposeFor(orgId: number, envelope: unknown, tx?: Tx): Promise<PurposeInput> {
    const parsed = outboundEnvelopeSchema.safeParse(envelope);
    if (parsed.success && parsed.data.kind === 'text' && parsed.data.email?.marketing) {
      return 'marketing_messaging';
    }
    if (parsed.success && parsed.data.kind === 'template') {
      const t = parsed.data.template;
      return this.consentGate.purposeOfTemplate(orgId, t.name, t.language, tx);
    }
    return 'service_messaging';
  }

  /** Checks that can be made before anything is stored. Throws an AppError with a stable code. */
  async assertCanQueue(
    req: DispatchRequest,
    opts: QueueCheckOptions = {},
  ): Promise<{ window: WindowInfo }> {
    const envelope = this.parse(req.envelope);
    const adapter = this.adapters.for(req.channel.kind);
    const window = this.assertChannelCan(
      adapter,
      req.channel,
      envelope,
      req.lastInboundAt,
      opts.now,
    );

    // Before the plan cap and before any row exists: a refused marketing message costs nothing and tells the agent why.
    await this.assertConsent(req, envelope, window);
    if (opts.monthlyUsed !== undefined && req.channel.settings.metered) {
      await this.plans.assertWithinLimit(req.channel.orgId, 'monthly_messages', opts.monthlyUsed);
    }
    return { window };
  }

  /** Worker side: guard, then one adapter call per client reference. Throws `ChannelError` (retryable or not) or an AppError. */
  async send(req: DispatchRequest, at?: Date): Promise<DispatchResult> {
    const now = at ?? new Date();
    const envelope = this.parse(req.envelope);
    const adapter = this.adapters.for(req.channel.kind);
    const window = this.assertChannelCan(adapter, req.channel, envelope, req.lastInboundAt, now);
    // An email reply is sent inside a customer's thread: with no mail to answer there is nobody to send to.
    if (req.channel.kind === 'email' && envelope.kind === 'text' && !envelope.email) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'There is no email in this conversation to reply to',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    await this.guard.beforeSend({
      orgId: req.channel.orgId,
      body: envelopeText(envelope),
      source: req.source ?? 'inbox',
    });

    const key = `chat:dispatch:${req.channel.orgId}:${req.channel.uuid}:${envelope.clientReference}`;
    const stored = await this.readStored(key);
    if (stored) return { ...stored, replayed: true };
    // At send time, not only at queue time: a STOP that arrived while the message waited in the queue still stops it.
    await this.assertConsent(req, envelope, window);
    // After the consent answer (a denied contact is never merely held) and at send time too: a message released from a hold passes
    // through here again, so the hours are checked once more on the clock of the moment it actually goes.
    await this.assertSendWindow(req, envelope, at);

    const owner = randomUUID();
    const locked = await this.redisCall(() =>
      this.redis.set(`${key}:lock`, owner, 'EX', LOCK_TTL_SECONDS, 'NX'),
    );
    if (locked !== 'OK') {
      // Another worker is sending this very message: let the queue come back to it instead of sending twice.
      throw new ChannelError('DISPATCH_IN_FLIGHT', 'This message is already being sent', true);
    }

    try {
      // A retry that arrives after the first attempt finished must see its answer, not send again.
      const again = await this.readStored(key);
      if (again) return { ...again, replayed: true };

      const sent = await this.callAdapter(adapter, req.channel, envelope);
      const result = {
        providerMessageId: sent.providerMessageId,
        acceptedAt: sent.acceptedAt,
        plannedReceipts: sent.plannedReceipts ?? [],
        ...(sent.meta ? { meta: sent.meta } : {}),
      };
      // The provider has accepted the message. Failing to remember that must not fail the send: a retryable error here makes the queue
      // send it again with no stored answer to find. The caller's own database write is the durable record, and a retry that still
      // finds the message queued is the narrow window this store exists to shrink, not one to widen.
      await this.redis
        .set(
          key,
          JSON.stringify({ ...result, acceptedAt: result.acceptedAt.toISOString() }),
          'EX',
          RESULT_TTL_SECONDS,
        )
        .catch((err: Error) =>
          this.logger.error(
            { orgId: req.channel.orgId, clientReference: envelope.clientReference, err: err.message },
            'provider accepted the message but its result could not be stored',
          ),
        );
      return { ...result, replayed: false };
    } finally {
      await this.redis.eval(RELEASE_IF_OWNER, 1, `${key}:lock`, owner).catch(() => undefined);
    }
  }

  /**
   * Queues the delivery steps a simulated provider reports after accepting a send. Separate from `send` on purpose: the caller runs
   * it AFTER it has stored the provider's id (the receipt finds its message through that id), so a `sent` receipt due in 0 ms can
   * never arrive before the message knows it was sent. Safe to call twice (the job ids are fixed, and a receipt is idempotent).
   */
  async scheduleReceipts(channel: ChannelRuntime, result: DispatchResult): Promise<void> {
    await this.planReceipts(
      channel,
      result.providerMessageId,
      result.plannedReceipts,
      result.acceptedAt,
    );
  }

  /**
   * Forgets the stored answer of a send. A provider can accept a message (the answer is stored) and then report, in a receipt, that it
   * could not deliver it; the agent's Retry of that message must really send again, not be handed the first answer. Only called for a
   * message the provider had already accepted, so it cannot double-send one that is still in flight.
   */
  async forget(channel: ChannelRuntime, clientReference: string): Promise<void> {
    const key = `chat:dispatch:${channel.orgId}:${channel.uuid}:${clientReference}`;
    await this.redisCall(() => this.redis.del(key));
  }

  /**
   * The ConsentGate for this send (BL-141). A deny ends the send with a stable code and a plain message; there is no override. A gate
   * failure is decided inside the gate (marketing fails closed, service replies fail open), so this never throws for a database error.
   */
  private async assertConsent(
    req: DispatchRequest,
    envelope: OutboundEnvelope,
    window: WindowInfo,
  ): Promise<void> {
    const { purpose, contactId } = req.consent;
    const subject: ConsentSubject =
      contactId != null
        ? { type: 'contact', id: contactId }
        : req.channel.kind === 'email'
          ? { type: 'email', email: envelope.to }
          : { type: 'phone', phone: envelope.to };
    const replyWindowOpen =
      purposeOf(purpose).ledgerPurpose === 'utility' &&
      envelope.kind !== 'template' &&
      req.lastInboundAt !== null &&
      window.open;
    const verdict = await this.consentGate.check(
      req.channel.orgId,
      subject,
      req.channel.kind,
      purpose,
      undefined,
      { replyWindowOpen },
    );
    if (verdict.decision !== 'deny') return;
    if (verdict.reason === 'withdrawn') {
      throw new AppError(
        ERROR_CODES.CONSENT_OPTED_OUT,
        'This contact has unsubscribed from messages of this kind, so the message was not sent.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    throw new AppError(
      ERROR_CODES.CONSENT_SEND_DENIED,
      'The message was not sent: this workspace requires a recorded consent for marketing messages and this contact has none.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /**
   * Quiet hours (BL-177): a MARKETING send inside them is HELD, never denied. Service replies and utility notices are never asked about.
   * Throws `SendHeldError`; the caller keeps the message and tries again at `hold.until`.
   */
  private async assertSendWindow(
    req: DispatchRequest,
    envelope: OutboundEnvelope,
    at: Date | undefined,
  ): Promise<void> {
    if (!this.sendWindow) return;
    const { purpose, contactId } = req.consent;
    if (!holdsPurpose(purposeOf(purpose).ledgerPurpose)) return;
    const mail = req.channel.kind === 'email';
    const decision = await this.sendWindow.check(
      req.channel.orgId,
      'message',
      {
        contactId: contactId ?? null,
        phone: mail ? null : envelope.to,
        email: mail ? envelope.to : null,
      },
      // A caller that names the instant (a test) is obeyed; otherwise the window service's own clock decides.
      at ? { now: at } : {},
    );
    const hold = holdOf(decision);
    if (hold) throw new SendHeldError(hold);
  }

  // --- internals ---------------------------------------------------------------------------------------------------------------

  private parse(raw: unknown): OutboundEnvelope {
    const parsed = outboundEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      throw AppError.validation(
        'Outbound message failed validation',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return parsed.data;
  }

  /** Connected, capable, and (for a free-form message) inside the window. Returns the window it computed. */
  private assertChannelCan(
    adapter: ChannelAdapter,
    channel: ChannelRuntime,
    envelope: OutboundEnvelope,
    lastInboundAt: Date | null,
    now: Date = new Date(),
  ): WindowInfo {
    // A WhatsApp group thread (`g:<group id>`) is addressed by its id, never by a phone number. The Cloud API channel and a personal
    // number (`whatsapp_qr`, over the linked device) each carry only the kinds WhatsApp accepts in a group.
    if (
      channel.kind === 'whatsapp_qr' &&
      isGroupPeer(envelope.to) &&
      !isPersonalGroupSendKind(envelope.kind)
    ) {
      throw new AppError(
        ERROR_CODES.CHANNEL_CAPABILITY_UNSUPPORTED,
        `A WhatsApp group cannot receive a ${envelope.kind} message`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (
      channel.kind === 'whatsapp_cloud' &&
      isGroupPeer(envelope.to) &&
      !isGroupSendKind(envelope.kind)
    ) {
      throw new AppError(
        ERROR_CODES.CHANNEL_CAPABILITY_UNSUPPORTED,
        `A WhatsApp group cannot receive a ${envelope.kind} message`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (channel.status !== 'connected') {
      throw new AppError(
        ERROR_CODES.CHANNEL_DISCONNECTED,
        'This channel is not connected',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const caps = effectiveCapabilitiesOf(adapter, channel);
    const unsupported = (what: string): never => {
      throw new AppError(
        ERROR_CODES.CHANNEL_CAPABILITY_UNSUPPORTED,
        `This channel cannot send ${what}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    };
    if (envelope.kind === 'text') {
      // The envelope schema carries the largest limit (email's); every other kind keeps WhatsApp's.
      const max = outboundTextMaxFor(channel.kind);
      if (envelope.body.length > max) {
        throw AppError.validation('Outbound message failed validation', [
          { path: 'body', message: `at most ${max} characters on this channel` },
        ]);
      }
      if (envelope.email && channel.kind !== 'email') unsupported('cc, bcc or a subject');
    }
    if (envelope.kind === 'template' && !caps.templates) unsupported('templates');
    if (envelope.kind === 'reaction' && !caps.reactions) unsupported('reactions');
    if (envelope.kind === 'media' && !caps.media.includes(envelope.media.mediaKind)) {
      unsupported(`${envelope.media.mediaKind} files`);
    }
    if (envelope.kind === 'location' && !caps.media.includes('location')) unsupported('locations');
    if (envelope.kind === 'contacts' && !caps.media.includes('contact'))
      unsupported('contact cards');
    if (envelope.kind === 'interactive' && !caps.interactive) unsupported('buttons');

    const window = adapter.windowInfo(channel, lastInboundAt, now);
    // A template is the one thing allowed outside the window; everything else is a free-form reply.
    if (envelope.kind !== 'template' && caps.windowHours !== null && !window.open) {
      throw new AppError(
        ERROR_CODES.SERVICE_WINDOW_CLOSED,
        'The 24 hour reply window is closed. Send an approved template instead.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return window;
  }

  private async callAdapter(
    adapter: ChannelAdapter,
    channel: ChannelRuntime,
    envelope: OutboundEnvelope,
  ) {
    try {
      return await adapter.send(channel, envelope);
    } catch (err) {
      if (err instanceof ChannelError) throw err;
      // An exception the adapter did not classify is a transport failure far more often than a refusal: retry it.
      this.logger.warn(
        { channel: channel.uuid, err: (err as Error).message },
        'adapter send failed unclassified',
      );
      throw new ChannelError('PROVIDER_UNREACHABLE', (err as Error).message || 'Send failed', true);
    }
  }

  private async planReceipts(
    channel: ChannelRuntime,
    providerMessageId: string,
    plan: PlannedReceipt[] | undefined,
    acceptedAt: Date,
  ): Promise<void> {
    for (const step of plan ?? []) {
      try {
        await this.publisher.enqueueReceipt(
          channel.orgId,
          channel.uuid,
          {
            providerMessageId,
            status: step.status,
            at: new Date(acceptedAt.getTime() + step.delayMs),
            errorCode: step.errorCode,
            errorMessage: step.errorMessage,
          },
          { delayMs: step.delayMs },
        );
      } catch (err) {
        // The message is already with the (simulated) provider; losing a simulated receipt must not fail or repeat the send.
        this.logger.warn(
          { channel: channel.uuid, err: (err as Error).message },
          'could not queue a simulated receipt',
        );
      }
    }
  }

  private async readStored(key: string): Promise<Omit<DispatchResult, 'replayed'> | null> {
    const raw = await this.redisCall(() => this.redis.get(key));
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as {
        providerMessageId: string;
        acceptedAt: string;
        plannedReceipts?: PlannedReceipt[];
        meta?: Record<string, unknown>;
      };
      return {
        providerMessageId: v.providerMessageId,
        acceptedAt: new Date(v.acceptedAt),
        plannedReceipts: v.plannedReceipts ?? [],
        ...(v.meta ? { meta: v.meta } : {}),
      };
    } catch {
      return null;
    }
  }

  /** Redis being down means idempotency cannot be promised: fail retryable instead of risking a double send. */
  private async redisCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new ChannelError('DISPATCH_STORE_UNAVAILABLE', (err as Error).message, true);
    }
  }
}
