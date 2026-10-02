import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import {
  ChannelError,
  envelopeText,
  outboundEnvelopeSchema,
  type ChannelAdapter,
  type ChannelRuntime,
  type OutboundEnvelope,
  type PlannedReceipt,
  type WindowInfo,
} from '../../infra/providers/chat-conversations';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  OUTBOUND_SEND_GUARD,
  type OutboundSendGuard,
} from '../../infra/providers/whatsapp/send-guard.port';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { effectiveCapabilitiesOf } from './channel-capabilities';
import { ChannelIngestPublisher } from './channel-ingest.publisher';

/** What the caller knows about the send. */
export interface DispatchRequest {
  channel: ChannelRuntime;
  /** Parsed with `outboundEnvelopeSchema`; its `clientReference` is the idempotency key of the send. */
  envelope: unknown;
  /** The customer's last inbound message on this thread: the anchor of the 24 hour rule. */
  lastInboundAt: Date | null;
  /** Recorded with a flagged or blocked send: `inbox`, `broadcast`, ... */
  source?: string;
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
  /** True when this key had already been sent: the stored answer is returned and the provider is not called again. */
  replayed: boolean;
}

const RESULT_TTL_SECONDS = 24 * 3600;
const LOCK_TTL_SECONDS = 120;
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
 * click) gets the stored answer and the provider is not called again. A failed send stores nothing, so a retry really retries. The
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
  ) {}

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

    if (opts.monthlyUsed !== undefined && req.channel.settings.metered) {
      await this.plans.assertWithinLimit(req.channel.orgId, 'monthly_messages', opts.monthlyUsed);
    }
    return { window };
  }

  /** Worker side: guard, then one adapter call per client reference. Throws `ChannelError` (retryable or not) or an AppError. */
  async send(req: DispatchRequest, now: Date = new Date()): Promise<DispatchResult> {
    const envelope = this.parse(req.envelope);
    const adapter = this.adapters.for(req.channel.kind);
    this.assertChannelCan(adapter, req.channel, envelope, req.lastInboundAt, now);

    await this.guard.beforeSend({
      orgId: req.channel.orgId,
      body: envelopeText(envelope),
      source: req.source ?? 'inbox',
    });

    const key = `chat:dispatch:${req.channel.orgId}:${req.channel.uuid}:${envelope.clientReference}`;
    const stored = await this.readStored(key);
    if (stored) return { ...stored, replayed: true };

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
      const result = { providerMessageId: sent.providerMessageId, acceptedAt: sent.acceptedAt };
      await this.redisCall(() =>
        this.redis.set(
          key,
          JSON.stringify({ ...result, acceptedAt: result.acceptedAt.toISOString() }),
          'EX',
          RESULT_TTL_SECONDS,
        ),
      );
      await this.planReceipts(
        req.channel,
        sent.providerMessageId,
        sent.plannedReceipts,
        sent.acceptedAt,
      );
      return { ...result, replayed: false };
    } finally {
      await this.redis.eval(RELEASE_IF_OWNER, 1, `${key}:lock`, owner).catch(() => undefined);
    }
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
    if (envelope.kind === 'template' && !caps.templates) unsupported('templates');
    if (envelope.kind === 'reaction' && !caps.reactions) unsupported('reactions');
    if (envelope.kind === 'media' && !caps.media.includes(envelope.media.mediaKind)) {
      unsupported(`${envelope.media.mediaKind} files`);
    }
    if (envelope.kind === 'location' && !caps.media.includes('location')) unsupported('locations');

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
      const v = JSON.parse(raw) as { providerMessageId: string; acceptedAt: string };
      return { providerMessageId: v.providerMessageId, acceptedAt: new Date(v.acceptedAt) };
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
