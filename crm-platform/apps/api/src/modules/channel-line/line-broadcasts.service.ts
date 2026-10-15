import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ERROR_CODES,
  type CreateLineBroadcastInput,
  type LineAudienceList,
  type LineBroadcast,
  type LineBroadcastCompose,
  type LineBroadcastList,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { LINE_TEMPLATES, type LineTemplates } from './_shims/tokens';
import { AUDIENCE_LIMIT, mediaKindFor, progressPct } from './broadcast-rules';
import { ChannelsRepository } from './channels.repository';
import { LineBroadcastsRepository, type LineBroadcastRow } from './line-broadcasts.repository';

const MODULE_KEY = 'line_broadcasts';
const LIST_LIMIT = 50;

export interface LineBroadcastJob {
  orgId: number;
  broadcastId: number;
}

const refuse = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
) => new AppError(ERROR_CODES[code], message, status);

/**
 * LINE broadcasts: the audience a channel can reach, composing a draft with a frozen recipient list, and the operator's start, pause,
 * retry and delete. The sending itself is `LineBroadcastSenderService`, run by a worker job.
 *
 * Decision: Reference's docs and changelog mention LINE's narrowcast API, but its code (and so this port) sends one push per person.
 * Difference from Reference: the send loop is a queue job, not an open browser tab, so closing the page no longer pauses it.
 */
@Injectable()
export class LineBroadcastsService {
  private readonly logger = new Logger(LineBroadcastsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LineBroadcastsRepository,
    private readonly channels: ChannelsRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(LINE_TEMPLATES) private readonly templates: LineTemplates,
    @InjectQueue(QUEUES.LINE_BROADCAST) private readonly queue: Queue<LineBroadcastJob>,
  ) {}

  private toResponse(r: LineBroadcastRow): LineBroadcast {
    return {
      id: r.uuid,
      name: r.name,
      channelId: r.channelUuid,
      channelName: r.channelName,
      templateId: r.templateUuid,
      status: r.status as LineBroadcast['status'],
      total: r.total,
      sent: r.sent,
      failed: r.failed,
      blocked: r.blocked,
      progress: progressPct(r.sent, r.failed, r.blocked, r.total),
      hasMedia: r.mediaPath !== null,
      lastError: r.lastError,
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** The people a channel carries (the 500 newest direct threads). */
  async audience(channelUuid: string): Promise<LineAudienceList> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const channel = await this.channels.findByUuid(tx, orgId, channelUuid);
      if (!channel) throw AppError.notFound('LINE channel', channelUuid);
      const rows = await this.repo.audience(tx, orgId, channel.id, AUDIENCE_LIMIT);
      return {
        data: rows.map((c) => ({
          userId: c.userId,
          title: c.title,
          lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
          unread: c.unread,
        })),
      };
    });
  }

  /** What the compose page opens with. */
  async compose(): Promise<LineBroadcastCompose> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const channels = await this.channels.list(tx, orgId);
      const templates = await this.templates.list(tx, orgId);
      return {
        channels: channels.map((c) => ({
          id: c.uuid,
          displayName: c.displayName,
          basicId: c.basicId,
          active: c.active,
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

  /** The 50 newest broadcasts, with totals across all of them. */
  async list(): Promise<LineBroadcastList> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, orgId, LIST_LIMIT);
      const stats = await this.repo.stats(tx, orgId);
      return { data: rows.map((r) => this.toResponse(r)), stats };
    });
  }

  async create(input: CreateLineBroadcastInput): Promise<LineBroadcast> {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const channel = await this.channels.findByUuid(tx, ctx.orgId, input.channelId);
      if (!channel) throw AppError.notFound('LINE channel', input.channelId);

      const template = input.templateId
        ? await this.templates.find(tx, ctx.orgId, input.templateId)
        : undefined;
      if (input.templateId && !template) throw AppError.notFound('Template', input.templateId);

      const body = input.body || template?.body || '';
      if (body === '' && !input.mediaUrl) {
        throw refuse('LINE_BROADCAST_EMPTY', 'A broadcast needs a message, a file, or both.');
      }

      // Forged ids are dropped: only people this channel really carries can be picked.
      const audience = new Map(
        (await this.repo.audience(tx, ctx.orgId, channel.id, AUDIENCE_LIMIT)).map((c) => [
          c.userId,
          c,
        ]),
      );
      const picked = [...new Set(input.userIds)]
        .map((id) => audience.get(id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined);
      if (picked.length === 0) {
        throw refuse('LINE_NO_RECIPIENTS', 'None of those users belong to this channel.');
      }

      const buttons = Array.isArray(template?.buttons) && template.buttons.length > 0;
      const id = await this.repo.insert(tx, ctx.orgId, {
        channelRowId: channel.id,
        userId: ctx.userId,
        name: input.name,
        templateId: template?.id ?? null,
        body: body === '' ? null : this.crypto.encrypt(body),
        buttons: buttons ? JSON.stringify(template?.buttons) : null,
        mediaPath: input.mediaUrl ?? null,
        mediaKind: input.mediaUrl ? mediaKindFor(input.mediaUrl) : null,
        total: picked.length,
      });
      await this.repo.insertRecipients(
        tx,
        ctx.orgId,
        id,
        picked.map((c) => ({ userId: c.userId, title: c.title, conversationId: c.conversationId })),
      );
      const row = await this.repo.findById(tx, ctx.orgId, id);
      if (!row) throw AppError.notFound('LINE broadcast', String(id));
      await this.audit.record(tx, { module: MODULE_KEY, recordId: id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: id,
        eventType: 'line.broadcast.created',
        payload: { uuid: row.uuid, channel: channel.basicId, total: picked.length },
      });
      return this.toResponse(row);
    });
  }

  /** Draft to sending; the worker picks it up. Already sending is returned as it is. */
  async start(uuid: string): Promise<LineBroadcast> {
    const ctx = RequestContextStore.require();

    const { row, version } = await this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('LINE broadcast', uuid);
      if (found.status === 'sending') return { row: found, version: null };

      const channel = await this.channels.findById(tx, ctx.orgId, found.channelRowId);
      if (!channel) {
        throw refuse(
          'LINE_CHANNEL_UNAVAILABLE',
          'The LINE channel this broadcast was built for is no longer connected.',
        );
      }
      if (!channel.active) {
        throw refuse(
          'LINE_CHANNEL_UNAVAILABLE',
          'That LINE channel is paused. Enable it before sending.',
        );
      }
      if ((await this.repo.pendingCount(tx, ctx.orgId, found.id)) === 0) {
        throw refuse(
          'LINE_NOTHING_TO_SEND',
          'Every recipient in this broadcast has already been handled.',
        );
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
        eventType: 'line.broadcast.started',
        payload: { uuid: found.uuid },
      });
      const fresh = await this.repo.findById(tx, ctx.orgId, found.id);
      return { row: fresh ?? found, version: next };
    });

    if (version !== null) await this.enqueue(ctx.orgId, row, version);
    return this.toResponse(row);
  }

  /** Back to draft: unsent people stay pending and the running job stops at its next batch. */
  async pause(uuid: string): Promise<LineBroadcast> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('LINE broadcast', uuid);
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
        eventType: 'line.broadcast.paused',
        payload: { uuid: found.uuid },
      });
      const fresh = await this.repo.findById(tx, ctx.orgId, found.id);
      return this.toResponse(fresh ?? found);
    });
  }

  /** Failed people back to pending (blocked stay blocked); the broadcast is a draft again, ready to start. */
  async retry(uuid: string): Promise<{ retried: number }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('LINE broadcast', uuid);
      if (found.status === 'sending') {
        throw refuse(
          'LINE_NOTHING_TO_RETRY',
          'This broadcast is still sending. Pause it or wait until it has finished.',
          HttpStatus.CONFLICT,
        );
      }
      const retried = await this.repo.resetFailed(tx, ctx.orgId, found.id);
      if (retried === 0)
        throw refuse('LINE_NOTHING_TO_RETRY', 'Nothing to retry: no recipient failed.');
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
        eventType: 'line.broadcast.retry_requested',
        payload: { uuid: found.uuid, retried },
      });
      return { retried };
    });
  }

  /** Any status, including sending: a job that is mid-run finds nothing at its next batch and stops. */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('LINE broadcast', uuid);
      await this.repo.remove(tx, ctx.orgId, found.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: found.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: found.id,
        eventType: 'line.broadcast.deleted',
        payload: { uuid: found.uuid, status: found.status },
      });
    });
  }

  /** The row version names the job, so a pause then a start queues a fresh run instead of colliding with the finished one. */
  private async enqueue(orgId: number, row: LineBroadcastRow, version: number): Promise<void> {
    try {
      await this.queue.add(
        'send',
        { orgId, broadcastId: row.id },
        { jobId: `${row.uuid}-${version}`, removeOnComplete: 100, removeOnFail: 100 },
      );
    } catch (err) {
      // No job means nothing would ever send it: put it back to a draft so the operator can press Start again.
      this.logger.error({ orgId, broadcast: row.uuid, err }, 'could not queue line broadcast');
      await this.db.txAs({ orgId }, (tx) => this.repo.setStatus(tx, orgId, row.id, 'draft'));
      throw refuse(
        'LINE_CHANNEL_UNAVAILABLE',
        'The send queue is unavailable. Try again in a moment.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
