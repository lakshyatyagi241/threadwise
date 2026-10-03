import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import type {
  GroupSnapshot,
  ReceiptUpdate,
} from '../../../infra/providers/node-bridge-runtime/inbound.port';
import type { Normalized } from '../../../infra/providers/node-bridge-runtime/inbound-normalizer';

/**
 * Where inbound traffic goes (TW-NODE-016 to 021). The runtime reads WhatsApp; the inbox, the broadcast and schedule
 * receipts and the group directory consume what it read. Each consumer registers itself when its domain is built, so the
 * runtime never depends on them and nothing is wired to a service that does not exist.
 *
 * Reference posted every inbound message to `api/inbound-message` over HTTP; this is the same contract in-process.
 */
export interface InboundSink {
  /** A customer message, the business's own message (echo), or a group message. */
  message(
    ctx: { orgId: number; deviceId: number },
    n: Normalized,
    /** The customer's file, when the message carries one and it was small enough to keep. */
    media?: Buffer,
  ): Promise<void>;
  /** The device's connection state changed (the inbox keeps its channel in step). */
  deviceStatus?(
    ctx: { orgId: number; deviceId: number },
    state: { status: string; connected: boolean },
  ): Promise<void>;
  /** The groups this device is in, after a change. */
  groups?(ctx: { orgId: number; deviceId: number }, groups: GroupSnapshot[]): Promise<void>;
}

const DEDUP_TTL_S = 7 * 24 * 3600;

@Injectable()
export class InboundRouter {
  private readonly logger = new Logger(InboundRouter.name);
  private readonly sinks: InboundSink[] = [];
  private warned = false;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  register(sink: InboundSink): void {
    this.sinks.push(sink);
  }

  get hasSinks(): boolean {
    return this.sinks.length > 0;
  }

  /**
   * Delivers one message to every sink, once. The same message arrives more than once (a reconnect replays, the phone echoes
   * what the bridge mirrored), so a message id already seen for this device is dropped here: the idempotency Reference got from
   * a unique key in the database.
   */
  async message(
    orgId: number,
    deviceId: number,
    n: Normalized,
    media?: Buffer,
  ): Promise<'delivered' | 'duplicate' | 'no_consumer'> {
    const first = await this.redis.set(
      `wa:in:${orgId}:${deviceId}:${n.message.providerMessageId}:${n.kind}`,
      '1',
      'EX',
      DEDUP_TTL_S,
      'NX',
    );
    if (first !== 'OK') return 'duplicate';
    if (this.sinks.length === 0) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          '[NODE] inbound messages are arriving but no inbox is registered to take them',
        );
      }
      return 'no_consumer';
    }
    for (const s of this.sinks) {
      try {
        await s.message({ orgId, deviceId }, n, media);
      } catch (err) {
        // One consumer failing must not stop the others, and must not lose the message for them.
        this.logger.error(
          { orgId, deviceId, err: String(err) },
          '[NODE] an inbound consumer failed',
        );
      }
    }
    return 'delivered';
  }

  async deviceStatus(
    orgId: number,
    deviceId: number,
    state: { status: string; connected: boolean },
  ): Promise<void> {
    for (const s of this.sinks) {
      try {
        await s.deviceStatus?.({ orgId, deviceId }, state);
      } catch (err) {
        this.logger.error({ orgId, deviceId, err: String(err) }, '[NODE] a status consumer failed');
      }
    }
  }

  async groups(orgId: number, deviceId: number, groups: GroupSnapshot[]): Promise<void> {
    for (const s of this.sinks) {
      try {
        await s.groups?.({ orgId, deviceId }, groups);
      } catch (err) {
        this.logger.error({ orgId, deviceId, err: String(err) }, '[NODE] a group consumer failed');
      }
    }
  }
}

/** One delivery report about a message we sent, in our terms (the same shape the broadcast receipts take). */
export interface DeliveryReport {
  /** Which number reported it, for a consumer that keeps messages per channel (the inbox). */
  orgId: number;
  deviceId: number;
  providerMessageId: string;
  status: 'delivered' | 'read';
  occurredAt: Date;
}

/** Returns true when the report was about a message this consumer owns, whether or not it changed anything. */
export type ReceiptSink = (report: DeliveryReport) => Promise<boolean>;

/** Baileys' ack level: 3 delivered, 4 read, 5 played (read); 1 and 2 say nothing new (TW-NODE-020 rule 1). */
export function ackStatus(ack: number): 'delivered' | 'read' | null {
  if (ack === 3) return 'delivered';
  if (ack === 4 || ack === 5) return 'read';
  return null;
}

/**
 * Hands a delivery report to the first consumer that owns the message. Reference decided by whether the id was in Node's memory
 * (so a restart sent in-flight broadcasts' receipts to the wrong place); here every consumer looks the id up in its own rows.
 */
@Injectable()
export class ReceiptRouter {
  private readonly sinks: ReceiptSink[] = [];

  register(sink: ReceiptSink): void {
    this.sinks.push(sink);
  }

  async route(
    ctx: { orgId: number; deviceId: number },
    u: ReceiptUpdate,
    now: Date = new Date(),
  ): Promise<boolean> {
    const status = ackStatus(u.ack);
    if (!status) return false;
    const report: DeliveryReport = {
      orgId: ctx.orgId,
      deviceId: ctx.deviceId,
      providerMessageId: u.providerMessageId,
      status,
      occurredAt: now,
    };
    for (const s of this.sinks) {
      if (await s(report)) return true;
    }
    return false;
  }
}
