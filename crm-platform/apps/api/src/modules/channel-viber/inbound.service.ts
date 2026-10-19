import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { tryParseViberJson } from '../../infra/providers/channel-viber/viber-json';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { incrWithTtl } from '../../infra/redis/incr-with-ttl';
import { WebhookRetryService } from '../webhook-retry';
import { ChatInboxIngest } from './_shims/chat-inbox-ingest';
import { signatureMatches } from './channel-rules';
import { ChannelsRepository, type ChannelRow } from './channels.repository';
import { readEvent, type ViberEvent } from './event-rules';
import { VibBroadcastsRepository } from './vib-broadcasts.repository';

/** Reference throttled the route to 240 a minute; this only stops a flood from one routing token. */
const HITS_PER_MINUTE = 240;

/** What the webhook retry queue carries for a Viber event that could not be stored. */
interface DeferredEvent {
  orgId: number;
  channelId: number;
  event: ViberEvent;
}

export interface Ack {
  status: number;
  status_message?: string;
}
const ack: Ack = { status: 0 };

/**
 * The public Viber webhook (TW-VIB-003 to 006): one signed address per channel.
 *
 * The tenant is found through a narrow SECURITY DEFINER lookup, then the signature (`X-Viber-Content-Signature`, the hex HMAC-SHA256 of
 * the RAW body with the auth token) is checked before anything is read. Viber retries anything but a 2xx, so every outcome after the
 * signature, an unknown channel, a paused one and an event of a kind we do not use included, answers 200 and does nothing. A wrong
 * signature is refused (403) as Reference did; only a flood is throttled (429). An event we could not store answers 503 so Viber
 * redelivers it (ASYNC-017): never a 200 for a message that was not kept.
 */
@Injectable()
export class InboundService implements OnModuleInit {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChannelsRepository,
    private readonly broadcasts: VibBroadcastsRepository,
    private readonly crypto: CryptoService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly inbox: ChatInboxIngest,
    private readonly retry: WebhookRetryService,
  ) {}

  onModuleInit(): void {
    this.retry.register<DeferredEvent>('viber', (p) => this.reprocess(p));
  }

  /** `forbidden` is a wrong signature: the controller answers 403. */
  async ingest(token: string, raw: Buffer, signature: string): Promise<Ack | 'forbidden'> {
    await this.rateLimit(token);

    const found = await this.db.primary.execute(sql`SELECT * FROM vib_channel_lookup(${token})`);
    const hit = found.rows[0] as
      { channel_org_id: number | string; channel_row_id: number | string } | undefined;
    if (!hit) return ack; // an unknown channel is acknowledged quietly
    const orgId = Number(hit.channel_org_id);

    const channel = await this.db.txAs({ orgId }, (tx) =>
      this.repo.findById(tx, orgId, Number(hit.channel_row_id)),
    );
    if (!channel) return ack;

    if (!signatureMatches(raw, signature, this.crypto.decrypt(channel.authToken))) {
      this.logger.warn({ orgId, channel: channel.id }, 'viber inbound signature mismatch');
      return 'forbidden';
    }

    const event = readEvent(tryParseViberJson(raw.toString('utf8')));
    // Viber's validation ping and a paused channel are acknowledged and nothing else happens.
    if (event.kind === 'ping' || event.kind === 'ignore' || !channel.active) return ack;

    try {
      await this.db.txAs({ orgId }, (tx) => this.repo.touchInbound(tx, orgId, channel.id));
      await this.dispatch(orgId, channel, event);
    } catch (err) {
      this.logger.error({ err, orgId, channel: channel.id }, 'viber ingest failed');
      // A rule the data broke (an AppError) fails the same way on every retry: acknowledge it instead of retrying for ever.
      if (err instanceof AppError) return ack;
      // Anything else (database, redis, provider) may pass: the event is kept in the retry queue and Viber keeps its 200.
      await this.defer(orgId, channel, event);
    }
    return ack;
  }

  /** Keeps a failed event in the webhook retry queue; when even that fails nothing was kept, so Viber must redeliver (503). */
  private async defer(orgId: number, channel: ChannelRow, event: ViberEvent): Promise<void> {
    try {
      await this.retry.defer('viber', {
        orgId,
        channelId: channel.id,
        event,
      } satisfies DeferredEvent);
    } catch (err) {
      this.logger.error({ err, orgId, channel: channel.id }, 'viber event could not be deferred');
      throw new AppError(
        ERROR_CODES.INTERNAL,
        'Could not keep the event, please retry',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /** The retry queue's second go at a deferred event. A failure is thrown so the queue retries it with backoff. */
  private async reprocess(p: DeferredEvent): Promise<void> {
    const channel = await this.db.txAs({ orgId: p.orgId }, (tx) =>
      this.repo.findById(tx, p.orgId, p.channelId),
    );
    if (!channel?.active) return;
    await this.dispatch(p.orgId, channel, p.event);
  }

  private async dispatch(orgId: number, channel: ChannelRow, event: ViberEvent): Promise<void> {
    switch (event.kind) {
      case 'message':
        await this.inbox.recordInbound(orgId, channel.id, event.message);
        return;
      case 'subscribe':
        // Only a confirmed subscribe is a person who can be written to; either way the thread exists from now on (Reference).
        await this.inbox.ensureThread(orgId, channel.id, event.user);
        return;
      case 'unsubscribe':
        // Reference only logs it; the user stays in the inbox, and Viber refuses a later send to them.
        this.logger.log({ orgId, channel: channel.id, user: event.userId }, 'viber unsubscribe');
        return;
      case 'receipt':
        await this.receipt(orgId, channel, event);
        return;
      default:
        return;
    }
  }

  /**
   * delivered, seen and failed. A broadcast's recipient is matched on the token Viber gave the batch AND the user (a batch of up to 300
   * shares one token); anything else is an inbox reply, whose ledger id is the token itself. Either way the message in the thread moves.
   */
  private async receipt(
    orgId: number,
    channel: ChannelRow,
    e: Extract<ViberEvent, { kind: 'receipt' }>,
  ): Promise<void> {
    const at = new Date();
    const matched =
      e.userId === ''
        ? false
        : await this.db.txAs({ orgId }, (tx) =>
            this.broadcasts.applyReceipt(tx, orgId, e.token, e.userId, e.status, at, e.desc),
          );
    await this.inbox.recordReceipt(orgId, channel.id, {
      providerMessageId: matched ? `${e.token}:${e.userId}` : e.token,
      status: e.status,
      at,
      ...(e.desc !== '' ? { reason: e.desc } : {}),
    });
  }

  private async rateLimit(token: string): Promise<void> {
    try {
      const key = `viber_hits:${token}:${Math.floor(Date.now() / 60_000)}`;
      const n = await incrWithTtl(this.redis, key, 120);
      if (n > HITS_PER_MINUTE) {
        throw new AppError(
          ERROR_CODES.RATE_LIMITED,
          'Too many requests',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Redis down: the webhook keeps working, unthrottled.
    }
  }
}
