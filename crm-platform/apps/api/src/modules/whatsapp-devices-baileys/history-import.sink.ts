import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { ChannelRegistryService, InboundIngestService } from '../chat-conversations';
import { InboundRouter, type HistoryBatch, type InboundSink } from '../node-bridge-runtime';
import { HistoryImportRepository, type HistoryRunRow } from './history-import.repository';
import { HistoryImportService } from './history-import.service';
import { isFinalBatch, planBatch, toIngest, type RunUsage } from './history-import-rules';
import { CappedMap } from '../../common/cache/capped-map';

const TALLY_TTL_S = 3 * 24 * 3600;
/** While a long batch is being stored, the run is marked alive at least this often. */
const TOUCH_EVERY_MS = 15_000;
/** A batch must have this many attempts before its failure rate says anything about the pipeline. */
const MIN_FOR_FAILURE_RATE = 10;
/** The name of an error, never its message (a database error can quote the row). */
const errorName = (e: unknown): string => (e instanceof Error ? e.name : 'Error');
const tallyKeys = (orgId: number, runId: number) => ({
  perChat: `wa:hist:${orgId}:${runId}:pc`,
  chats: `wa:hist:${orgId}:${runId}:ch`,
});

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D+/g, '');

/**
 * The importer: the history of a first link, stored quietly in the inbox (TW-WAHIST). It takes one bounded batch at a time from the runtime
 * (the socket does not read the next slice before this returns, which is the backpressure), and only for a number whose person opted in
 * and whose run is still active. Everything it stores goes through the inbox's own ingest with the `history` marker, the same quiet path as
 * the Cloud API coexistence import: dated by the original time, no unread, no alert, no flow, keyword reply, AI or routing, no
 * `conversation.created` event, one ledger row per provider message id so a delivered batch is idempotent. A person's chat gets a contact
 * made quietly (counted against the plan's cap; no consent is ever recorded); a group gets none and goes to its `g:<id>` thread.
 * Media is not downloaded: the message keeps a placeholder.
 *
 * It runs in the worker. A failure is logged and swallowed by the router, and ends the run as `failed`, never the connection.
 */
@Injectable()
export class HistoryImportSink implements InboundSink, OnModuleInit {
  private readonly logger = new Logger(HistoryImportSink.name);
  private readonly channels = new CappedMap<string, { uuid: string; at: number }>(5000);

  constructor(
    private readonly router: InboundRouter,
    private readonly db: DatabaseService,
    private readonly repo: HistoryImportRepository,
    private readonly service: HistoryImportService,
    private readonly ingest: InboundIngestService,
    private readonly registry: ChannelRegistryService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly gate: UnofficialWhatsappGate,
  ) {}

  onModuleInit(): void {
    this.router.register(this);
  }

  /** Live messages are the inbox bridge's business. */
  async message(): Promise<void> {
    return;
  }

  async history(ctx: { orgId: number; deviceId: number }, batch: HistoryBatch): Promise<void> {
    const { orgId, deviceId } = ctx;
    if (!(await this.gate.isEnabledFor(orgId))) return;
    const run = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.active(tx, orgId, deviceId),
    );
    // No active run: the person did not opt in, or cancelled. WhatsApp's history is dropped, not stored.
    if (!run) return;
    if (batch.error) {
      // The adapter could not do its job (a deployment without the limits provider): fail the run, never guess.
      this.logger.error(
        { orgId, deviceId, runId: run.id, code: batch.error },
        '[HISTORY] the adapter reported a fault: the run is failed',
      );
      await this.service.finishAs(orgId, run.id, 'failed', batch.error);
      return;
    }
    try {
      await this.process(orgId, run, batch);
    } catch (err) {
      this.logger.error(
        { orgId, deviceId, runId: run.id, err: String(err) },
        '[HISTORY] a batch could not be stored',
      );
      await this.service.finishAs(orgId, run.id, 'failed', 'worker_error');
      // The tallies of a failed run are not kept for ever either.
      await this.expire(tallyKeys(orgId, run.id));
    }
  }

  private async process(orgId: number, run: HistoryRunRow, batch: HistoryBatch): Promise<void> {
    if (run.state === 'idle') {
      await this.db.txAs({ orgId, userId: null }, (tx) => this.repo.markRunning(tx, orgId, run.id));
    }
    // Alive from the first moment of the batch: the idle sweep measures from here, so a batch that takes long is never "quiet".
    await this.touch(orgId, run.id);
    const keys = tallyKeys(orgId, run.id);
    const channelUuid = await this.channelOf(orgId, run.device_id);

    // What the inbox already holds costs no room (a redelivered batch, an overlap between WhatsApp's sync types).
    const known = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.knownProviderIds(
        tx,
        orgId,
        channelUuid,
        batch.messages.map((n) => n.message.providerMessageId),
      ),
    );
    const fresh = {
      ...batch,
      messages: batch.messages.filter((n) => !known.has(n.message.providerMessageId)),
    };
    const usage = await this.usageOf(run, keys);
    const plan = planBatch(
      fresh,
      {
        maxMessages: run.max_messages,
        maxMessagesPerChat: run.max_messages_per_chat,
        maxChats: run.max_chats,
      },
      usage,
    );

    let stored = 0;
    let attempted = 0;
    let failed = 0;
    let chatsCreated = 0;
    let contactsCreated = 0;
    let stopReason: 'limit_reached' | null = null;
    let cancelled = false;
    let lastTouch = Date.now();

    try {
      for (const chat of plan.chats) {
        // A cancel lands between chats: stop taking more, keep (and count) what is stored.
        if (!(await this.stillActive(orgId, run.id))) {
          cancelled = true;
          break;
        }
        if (chat.firstSeen) await this.redis.sadd(keys.chats, chat.peerKey);
        let storedInChat = 0;
        try {
          for (const m of chat.messages) {
            attempted++;
            let out;
            try {
              out = await RequestContextStore.run(
                {
                  requestId: `wa-history-${randomUUID()}`,
                  orgId,
                  actorType: 'system',
                  actorId: null,
                  userId: null,
                },
                () =>
                  this.ingest.ingest(
                    {
                      orgId,
                      channelUuid,
                      message: (({ providerTimestamp, ...rest }) => ({
                        ...rest,
                        providerTimestamp: providerTimestamp.toISOString(),
                      }))(toIngest(m, chat)),
                    },
                    { finalAttempt: true },
                  ),
              );
            } catch (err) {
              // One bad message must not fail the run: skipped and counted. Ids only in the log, never a name, a number or a text.
              failed++;
              this.logger.warn(
                { orgId, deviceId: run.device_id, runId: run.id, err: errorName(err) },
                '[HISTORY] a message could not be stored and was skipped',
              );
              continue;
            }
            if (Date.now() - lastTouch > TOUCH_EVERY_MS) {
              lastTouch = Date.now();
              await this.touch(orgId, run.id);
            }
            if (out.outcome !== 'stored') continue;
            stored++;
            storedInChat++;
            if (out.createdConversation) chatsCreated++;
            if (out.contactCreated) contactsCreated++;
            if (out.quotaReached) {
              stopReason = 'limit_reached';
              break;
            }
          }
        } finally {
          // One write per chat, whatever happened inside it.
          if (storedInChat > 0) await this.redis.hincrby(keys.perChat, chat.peerKey, storedInChat);
        }
        if (stopReason) break;
      }
    } finally {
      await this.expire(keys);
    }

    // Always counted, even when a cancel won: the totals say what is really in the inbox.
    const alive = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.addBatch(tx, orgId, run.id, {
        chats: chatsCreated,
        contacts: contactsCreated,
        messages: stored,
        progress: batch.progress,
      }),
    );
    if (cancelled || !alive) return; // cancelled: the cancel already ended and cleaned the run

    if (attempted >= MIN_FOR_FAILURE_RATE && failed * 2 > attempted) {
      // More than half of a batch could not be stored: that is the pipeline, not one bad message.
      this.logger.error(
        { orgId, deviceId: run.device_id, runId: run.id, attempted, failed },
        '[HISTORY] most messages of a batch failed: the run is failed',
      );
      await this.service.finishAs(orgId, run.id, 'failed', 'worker_error');
      await this.cleanup(keys);
    } else if (stopReason) {
      // The plan's contact cap: the run stops here, with what is already stored, and says why.
      await this.service.finishAs(orgId, run.id, 'limit_reached', 'contact_limit_reached');
      await this.cleanup(keys);
    } else if (plan.stop) {
      await this.service.finishAs(orgId, run.id, 'done', plan.stop);
      await this.cleanup(keys);
    } else if (isFinalBatch(run.mode, batch)) {
      await this.service.finishAs(orgId, run.id, 'done', null);
      await this.cleanup(keys);
    }
  }

  private async touch(orgId: number, runId: number): Promise<void> {
    await this.db
      .txAs({ orgId, userId: null }, (tx) => this.repo.touch(tx, orgId, runId))
      .catch(() => undefined);
  }

  private async expire(keys: ReturnType<typeof tallyKeys>): Promise<void> {
    await Promise.all([
      this.redis.expire(keys.perChat, TALLY_TTL_S),
      this.redis.expire(keys.chats, TALLY_TTL_S),
    ]).catch(() => undefined);
  }

  private async cleanup(keys: ReturnType<typeof tallyKeys>): Promise<void> {
    await this.redis.del(keys.perChat, keys.chats).catch(() => undefined);
  }

  private async usageOf(run: HistoryRunRow, keys: ReturnType<typeof tallyKeys>): Promise<RunUsage> {
    const [perChat, chats] = await Promise.all([
      this.redis.hgetall(keys.perChat),
      this.redis.smembers(keys.chats),
    ]);
    return {
      messages: run.messages_count ?? 0,
      perChat: new Map(Object.entries(perChat).map(([k, v]) => [k, Number(v)])),
      chats: new Set(chats),
    };
  }

  private stillActive(orgId: number, runId: number): Promise<boolean> {
    return this.db.txAs({ orgId, userId: null }, (tx) => this.repo.isActive(tx, orgId, runId));
  }

  /** The device's inbox channel, created on first use (the same one the live messages use). */
  private async channelOf(orgId: number, deviceId: number): Promise<string> {
    const key = `${orgId}:${deviceId}`;
    const hit = this.channels.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.uuid;
    const dev = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.deviceFacts(tx, orgId, deviceId),
    );
    if (!dev) throw new Error('device gone');
    const number = digits(dev.phone);
    const { uuid } = await RequestContextStore.run(
      {
        requestId: `wa-history-${randomUUID()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        this.registry.syncDeviceChannel(orgId, {
          uuid: dev.uuid,
          name: dev.name.trim() || number || 'WhatsApp',
          displayAddress: number ? `+${digits(dev.countryCode)}${number}` : null,
          connected: true,
        }),
    );
    this.channels.set(key, { uuid, at: Date.now() });
    return uuid;
  }
}
