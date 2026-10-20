import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  LINE_API,
  type LineApi,
  type LineApiFactory,
} from '../../infra/providers/channel-line/line.port';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { incrWithTtl } from '../../infra/redis/counter';
import { WebhookRetryService } from '../webhook-retry';
import {
  INBOUND_HOOKS,
  INBOX_INGEST,
  type InboundContext,
  type InboundHooks,
  type InboundMessageInput,
  type InboxIngest,
} from './_shims/tokens';
import { DEFAULT_NAME } from './_shims/chat-inbox-ingest';
import { signatureMatches } from './channel-rules';
import { ChannelsRepository, type ChannelRow } from './channels.repository';
import { eventsOf, readEvent, type LineEvent } from './event-rules';
import { LineTokenService } from './line-token.service';

/** Reference throttled the route to 240 requests a minute; here it is per routing token. */
const HITS_PER_MINUTE = 240;

/** What the webhook retry queue carries for a LINE event that could not be stored. */
interface DeferredEvent {
  orgId: number;
  channelId: number;
  event: LineEvent;
}

export type Ack = { kind: 'ack'; note: string } | { kind: 'bad_signature' };
const ack = (note: string): Ack => ({ kind: 'ack', note });

/**
 * The public LINE webhook: one signed address per channel.
 *
 * LINE's `X-Line-Signature` is checked on the RAW body with the channel secret before anything is read; a wrong one is refused (401,
 * as Reference does). An unknown address, a paused channel or an event nobody handles answers 200 with a note and does nothing, and a
 * failure on one event never stops the others. The tenant is found through a narrow SECURITY DEFINER lookup; from there on everything
 * runs under that organization's context. Only a flood is refused (429).
 */
@Injectable()
export class InboundService implements OnModuleInit {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChannelsRepository,
    private readonly crypto: CryptoService,
    private readonly tokens: LineTokenService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(LINE_API) private readonly line: LineApiFactory,
    @Inject(INBOX_INGEST) private readonly inbox: InboxIngest,
    @Inject(INBOUND_HOOKS) private readonly hooks: InboundHooks,
    private readonly retry: WebhookRetryService,
  ) {}

  onModuleInit(): void {
    this.retry.register<DeferredEvent>('line', (p) => this.reprocess(p));
  }

  async ingest(token: string, rawBody: Buffer, signature: string): Promise<Ack> {
    await this.rateLimit(token);

    const found = await this.db.primary.execute(sql`SELECT * FROM line_channel_lookup(${token})`);
    const hit = found.rows[0] as
      { channel_org_id: number | string; channel_row_id: number | string } | undefined;
    if (!hit) return ack('unknown channel');
    const orgId = Number(hit.channel_org_id);

    const channel = await this.db.txAs({ orgId }, (tx) =>
      this.repo.findById(tx, orgId, Number(hit.channel_row_id)),
    );
    if (!channel) return ack('unknown channel');

    const secret = this.crypto.decrypt(channel.channelSecret);
    if (!signatureMatches(rawBody, secret, signature)) {
      this.logger.warn({ orgId, channel: channel.id }, 'line inbound signature mismatch');
      return { kind: 'bad_signature' };
    }
    if (!channel.active) return ack('channel disabled');

    await this.db.txAs({ orgId }, (tx) => this.repo.touchInbound(tx, orgId, channel.id));

    let body: unknown = null;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return ack('not json');
    }
    // One token and one client for the whole delivery (a rotated token is minted at most once).
    const apiOf = this.apiOf(orgId, channel);

    // Every event is tried even if an earlier one failed. A failed one is kept in the webhook retry queue and LINE keeps its 200; only
    // when something could not even be kept does the delivery answer 503 (after the loop) so LINE redelivers it.
    let lost = 0;
    for (const event of eventsOf(body)) {
      try {
        await this.handle(orgId, channel, event, apiOf);
      } catch (err) {
        this.logger.error({ err, orgId, channel: channel.id }, 'line event ingest failed');
        // A rule the data broke (an AppError) fails the same way on every retry, so it is logged and not retried.
        if (err instanceof AppError) continue;
        if (!(await this.defer(orgId, channel, event))) lost += 1;
      }
    }
    if (lost > 0) {
      throw new AppError(
        ERROR_CODES.INTERNAL,
        'Could not keep the delivery, please retry',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return ack('ok');
  }

  private apiOf(orgId: number, channel: ChannelRow): () => Promise<LineApi> {
    let api: LineApi | undefined;
    return async () => (api ??= this.line.forToken(await this.tokens.accessToken(orgId, channel)));
  }

  /** Keeps a failed event in the webhook retry queue. False when even that failed (nothing was kept). */
  private async defer(orgId: number, channel: ChannelRow, event: LineEvent): Promise<boolean> {
    try {
      await this.retry.defer('line', {
        orgId,
        channelId: channel.id,
        event,
      } satisfies DeferredEvent);
      return true;
    } catch (err) {
      this.logger.error({ err, orgId, channel: channel.id }, 'line event could not be deferred');
      return false;
    }
  }

  /** The retry queue's second go at a deferred event. A failure is thrown so the queue retries it with backoff. */
  private async reprocess(p: DeferredEvent): Promise<void> {
    const channel = await this.db.txAs({ orgId: p.orgId }, (tx) =>
      this.repo.findById(tx, p.orgId, p.channelId),
    );
    if (!channel?.active) return;
    await this.handle(p.orgId, channel, p.event, this.apiOf(p.orgId, channel));
  }

  private async handle(
    orgId: number,
    channel: ChannelRow,
    event: LineEvent,
    apiOf: () => Promise<LineApi>,
  ): Promise<void> {
    const read = readEvent(event);
    if (read.kind === 'ignore') return;

    const direct = read.source.type === 'user';
    const { title, pictureUrl } = direct
      ? await this.sender(orgId, read.source.id, apiOf)
      : { title: DEFAULT_NAME, pictureUrl: null };

    const common = {
      sourceType: read.source.type,
      sourceId: read.source.id,
      userId: read.source.userId,
      title,
      pictureUrl,
      replyToken: read.meta.replyToken,
      webhookEventId: read.meta.webhookEventId,
    };
    const input: InboundMessageInput =
      read.kind === 'postback'
        ? {
            ...common,
            // A postback replayed as typed text: a redelivery carries the same webhook event id.
            providerMessageId: `pb:${read.meta.webhookEventId ?? randomUUID()}`,
            messageId: null,
            text: read.data,
            mediaType: null,
            mediaMessageId: null,
            fileName: null,
          }
        : {
            ...common,
            providerMessageId: read.meta.messageId ?? `line-${randomUUID()}`,
            messageId: read.meta.messageId,
            text: read.extracted.text,
            mediaType: read.extracted.mediaType,
            mediaMessageId: read.extracted.messageId,
            fileName: read.extracted.fileName,
          };

    // The file is downloaded by the channel adapter inside the ingest, with the channel's own token.
    const recorded = await this.inbox.recordInbound(orgId, channel.id, input);
    // A redelivered event is stored once: nothing runs a second time.
    if (!recorded.stored) return;

    const ctx: InboundContext = {
      orgId,
      channelRowId: channel.id,
      conversationId: recorded.conversationId,
      sourceId: read.source.id,
      sourceType: read.source.type,
      text: input.text,
      replyToken: read.meta.replyToken,
      newThread: recorded.newThread,
    };
    try {
      // Groups and rooms carry no user profile for a flow to key on: only a 1:1 chat can start or resume one (Reference).
      const consumed = direct ? await this.hooks.handoffToFlow(ctx) : false;
      if (!consumed) await this.hooks.automate(ctx);
    } catch (err) {
      this.logger.warn({ err, orgId, channel: channel.id }, 'line automation failed');
    }
  }

  /**
   * The sender's LINE profile (display name and picture), asked only until the person is a contact: after that the name is ours and
   * a message costs no API call. Best effort: no profile means the thread is called "LINE user".
   */
  private async sender(
    orgId: number,
    userId: string,
    apiOf: () => Promise<LineApi>,
  ): Promise<{ title: string; pictureUrl: string | null }> {
    const known = await this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT 1 FROM contacts WHERE org_id = ${orgId} AND channel = 'line' AND channel_uid = ${userId}`);
      return res.rows.length > 0;
    });
    if (known) return { title: DEFAULT_NAME, pictureUrl: null };
    try {
      const profile = await (await apiOf()).getProfile(userId);
      if (profile.ok) {
        return {
          title: profile.data?.displayName || DEFAULT_NAME,
          pictureUrl: profile.data?.pictureUrl ?? null,
        };
      }
    } catch {
      /* the profile is optional */
    }
    return { title: DEFAULT_NAME, pictureUrl: null };
  }

  private async rateLimit(token: string): Promise<void> {
    try {
      const key = `line_hits:${token}:${Math.floor(Date.now() / 60_000)}`;
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
