import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ERROR_CODES,
  type CreateTgBroadcastInput,
  type TelegramChat,
  type TgBroadcast,
  type TgBroadcastCompose,
  type TgBroadcastList,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { HELD_TABLES, heldOf, heldSummaries, type HeldSummary } from '../compliance-center';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  TELEGRAM_PLAN_GATE,
  TELEGRAM_TEMPLATES,
  type TelegramPlanGate,
  type TelegramTemplates,
} from './_shims/tokens';
import {
  AUDIENCE_LIMIT,
  chatType,
  mediaKindFor,
  progressPct,
  recipientKind,
} from './broadcast-rules';
import { BotsRepository } from './bots.repository';
import { TgBroadcastsRepository, type TgBroadcastRow } from './tg-broadcasts.repository';

const MODULE_KEY = 'telegram_broadcasts';
const LIST_LIMIT = 50;

export interface TgBroadcastJob {
  orgId: number;
  broadcastId: number;
}

const refuse = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
) => new AppError(ERROR_CODES[code], message, status);

/**
 * Telegram broadcasts (TW-TG-010 to 014): the audience a bot can reach, composing a draft with a frozen recipient list, and the
 * operator's start, pause, retry and delete. The sending itself is `TgBroadcastSenderService`, run by a worker job.
 *
 * Difference from Reference: the send loop is a queue job, not an open browser tab, so closing the page no longer pauses it.
 */
@Injectable()
export class TgBroadcastsService {
  private readonly logger = new Logger(TgBroadcastsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TgBroadcastsRepository,
    private readonly bots: BotsRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(TELEGRAM_PLAN_GATE) private readonly plan: TelegramPlanGate,
    @Inject(TELEGRAM_TEMPLATES) private readonly templates: TelegramTemplates,
    @InjectQueue(QUEUES.TG_BROADCAST) private readonly queue: Queue<TgBroadcastJob>,
  ) {}

  private toResponse(r: TgBroadcastRow, held?: HeldSummary): TgBroadcast {
    return {
      id: r.uuid,
      name: r.name,
      botId: r.botUuid,
      botUsername: r.botUsername,
      templateId: r.templateUuid,
      status: r.status as TgBroadcast['status'],
      total: r.total,
      sent: r.sent,
      failed: r.failed,
      blocked: r.blocked,
      progress: progressPct(r.sent, r.failed, r.blocked, r.total),
      held: held?.count ?? 0,
      heldUntil: held?.next?.toISOString() ?? null,
      hasMedia: r.mediaPath !== null,
      lastError: r.lastError,
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** The chats a bot carries (TW-TG-010). */
  async chats(botUuid: string): Promise<{ data: TelegramChat[] }> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertBroadcasts(orgId);
    return this.db.tx(async (tx) => {
      const bot = await this.bots.findByUuid(tx, orgId, botUuid);
      if (!bot) throw AppError.notFound('Telegram bot', botUuid);
      const rows = await this.repo.chats(tx, orgId, bot.id, AUDIENCE_LIMIT);
      return {
        data: rows.map((c) => ({
          chatId: c.chatId,
          title: c.title,
          type: chatType(c.chatId, c.seenTypes, c.anySender),
          lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
          unread: c.unread,
        })),
      };
    });
  }

  /** What the compose page opens with (TW-TG-012). */
  async compose(): Promise<TgBroadcastCompose> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertBroadcasts(orgId);
    return this.db.tx(async (tx) => {
      const bots = await this.bots.list(tx, orgId);
      const templates = await this.templates.list(tx, orgId);
      return {
        bots: bots.map((b) => ({
          id: b.uuid,
          username: b.username,
          name: b.name,
          active: b.active,
        })),
        templates: templates.map((t) => ({
          id: t.uuid,
          name: t.name,
          body: t.body,
          buttons: t.buttons,
        })),
      };
    });
  }

  /** The 50 newest broadcasts, with totals across all of them (TW-TG-011). */
  async list(): Promise<TgBroadcastList> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertBroadcasts(orgId);
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, orgId, LIST_LIMIT);
      const stats = await this.repo.stats(tx, orgId);
      const held = await heldSummaries(
        tx,
        orgId,
        HELD_TABLES.telegram,
        rows.map((r) => r.id),
      );
      return { data: rows.map((r) => this.toResponse(r, heldOf(held, r.id))), stats };
    });
  }

  async create(input: CreateTgBroadcastInput): Promise<TgBroadcast> {
    const ctx = RequestContextStore.require();
    await this.plan.assertBroadcasts(ctx.orgId);

    return this.db.tx(async (tx) => {
      const bot = await this.bots.findByUuid(tx, ctx.orgId, input.botId);
      if (!bot) throw AppError.notFound('Telegram bot', input.botId);

      const template = input.templateId
        ? await this.templates.find(tx, ctx.orgId, input.templateId)
        : undefined;
      if (input.templateId && !template) throw AppError.notFound('Template', input.templateId);

      const body = input.body || template?.body || '';
      if (body === '' && !input.mediaUrl) {
        throw refuse('TG_BROADCAST_EMPTY', 'A broadcast needs a message, a file, or both.');
      }

      // Forged ids are dropped: only chats this bot really carries can be picked.
      const audience = new Map(
        (await this.repo.chats(tx, ctx.orgId, bot.id, AUDIENCE_LIMIT)).map((c) => [c.chatId, c]),
      );
      const picked = [...new Set(input.chatIds)]
        .map((id) => audience.get(id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined);
      if (picked.length === 0) {
        throw refuse('TG_NO_RECIPIENTS', 'None of those chats belong to this bot.');
      }

      const buttons = Array.isArray(template?.buttons) && template.buttons.length > 0;
      const id = await this.repo.insert(tx, ctx.orgId, {
        botRowId: bot.id,
        userId: ctx.userId,
        name: input.name,
        templateId: template?.id ?? null,
        body: body === '' ? null : this.crypto.encrypt(body),
        buttons: buttons ? this.crypto.encrypt(JSON.stringify(template?.buttons)) : null,
        mediaPath: input.mediaUrl ?? null,
        mediaKind: input.mediaUrl ? mediaKindFor(input.mediaUrl) : null,
        total: picked.length,
      });
      await this.repo.insertRecipients(
        tx,
        ctx.orgId,
        id,
        picked.map((c) => ({
          chatId: c.chatId,
          title: c.title,
          kind: recipientKind(chatType(c.chatId, c.seenTypes, c.anySender)),
          conversationId: c.conversationId,
        })),
      );
      const row = await this.repo.findById(tx, ctx.orgId, id);
      if (!row) throw AppError.notFound('Telegram broadcast', String(id));
      await this.audit.record(tx, { module: MODULE_KEY, recordId: id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: id,
        eventType: 'telegram.broadcast.created',
        payload: { uuid: row.uuid, bot: bot.username, total: picked.length },
      });
      return this.toResponse(row);
    });
  }

  /** Draft to sending; the worker picks it up. Already sending is returned as it is. */
  async start(uuid: string): Promise<TgBroadcast> {
    const ctx = RequestContextStore.require();
    await this.plan.assertBroadcasts(ctx.orgId);

    const { row, version } = await this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('Telegram broadcast', uuid);
      if (found.status === 'sending') return { row: found, version: null };

      const bot = await this.bots.findById(tx, ctx.orgId, found.botRowId);
      if (!bot) throw refuse('TG_BOT_UNAVAILABLE', 'This bot is no longer connected.');
      if (!bot.active) {
        throw refuse(
          'TG_BOT_UNAVAILABLE',
          `The bot ${bot.username ? `@${bot.username}` : ''} is paused. Resume it before sending.`,
        );
      }
      if ((await this.repo.pendingCount(tx, ctx.orgId, found.id)) === 0) {
        throw refuse('TG_NOTHING_TO_SEND', 'There is nobody left to send this broadcast to.');
      }
      const next = await this.repo.setStatus(tx, ctx.orgId, found.id, 'sending', {
        markStarted: true,
        clearFinished: true,
      });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: found.id,
        action: 'update',
        delta: { status: { old: found.status, new: 'sending' } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: found.id,
        eventType: 'telegram.broadcast.started',
        payload: { uuid: found.uuid },
      });
      const fresh = await this.repo.findById(tx, ctx.orgId, found.id);
      return { row: fresh ?? found, version: next };
    });

    if (version !== null) await this.enqueue(ctx.orgId, row, version);
    return this.toResponse(row);
  }

  /** Back to draft: unsent chats stay pending and the running job stops at its next batch. */
  async pause(uuid: string): Promise<TgBroadcast> {
    const ctx = RequestContextStore.require();
    await this.plan.assertBroadcasts(ctx.orgId);
    return this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('Telegram broadcast', uuid);
      if (found.status !== 'sending') return this.toResponse(found);
      await this.repo.setStatus(tx, ctx.orgId, found.id, 'draft');
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: found.id,
        action: 'update',
        delta: { status: { old: 'sending', new: 'draft' } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: found.id,
        eventType: 'telegram.broadcast.paused',
        payload: { uuid: found.uuid },
      });
      const fresh = await this.repo.findById(tx, ctx.orgId, found.id);
      return this.toResponse(fresh ?? found);
    });
  }

  /** Failed chats back to pending (blocked stay blocked); the broadcast is a draft again, ready to start. */
  async retry(uuid: string): Promise<{ retried: number }> {
    const ctx = RequestContextStore.require();
    await this.plan.assertBroadcasts(ctx.orgId);
    return this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('Telegram broadcast', uuid);
      if (found.status === 'sending') {
        throw refuse(
          'TG_NOTHING_TO_RETRY',
          'This broadcast is still sending. Pause it or wait until it has finished.',
          HttpStatus.CONFLICT,
        );
      }
      const retried = await this.repo.resetFailed(tx, ctx.orgId, found.id);
      if (retried === 0) throw refuse('TG_NOTHING_TO_RETRY', 'No failed recipients to retry.');
      await this.repo.recompute(tx, ctx.orgId, found.id);
      await this.repo.setStatus(tx, ctx.orgId, found.id, 'draft', { clearFinished: true });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: found.id,
        action: 'update',
        delta: { status: { old: found.status, new: 'draft' } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: found.id,
        eventType: 'telegram.broadcast.retry_requested',
        payload: { uuid: found.uuid, retried },
      });
      return { retried };
    });
  }

  /** Any status, including sending: a job that is mid-run finds nothing at its next batch and stops. */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.plan.assertBroadcasts(ctx.orgId);
    await this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('Telegram broadcast', uuid);
      await this.repo.remove(tx, ctx.orgId, found.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: found.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: found.id,
        eventType: 'telegram.broadcast.deleted',
        payload: { uuid: found.uuid, status: found.status },
      });
    });
  }

  /** The row version names the job, so a pause then a start queues a fresh run instead of colliding with the finished one. */
  private async enqueue(orgId: number, row: TgBroadcastRow, version: number): Promise<void> {
    try {
      await this.queue.add(
        'send',
        { orgId, broadcastId: row.id },
        { jobId: `${row.uuid}-${version}`, removeOnComplete: 100, removeOnFail: 100 },
      );
    } catch (err) {
      // No job means nothing would ever send it: put it back to a draft so the operator can press Start again.
      this.logger.error({ orgId, broadcast: row.uuid, err }, 'could not queue telegram broadcast');
      await this.db.txAs({ orgId }, (tx) => this.repo.setStatus(tx, orgId, row.id, 'draft'));
      throw refuse(
        'TG_BOT_UNAVAILABLE',
        'The send queue is unavailable. Try again in a moment.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
