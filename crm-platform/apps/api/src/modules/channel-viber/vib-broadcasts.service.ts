import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ERROR_CODES,
  type CreateVibBroadcastInput,
  type ViberUserList,
  type VibBroadcast,
  type VibBroadcastCompose,
  type VibBroadcastList,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { HELD_TABLES, heldOf, heldSummaries, type HeldSummary } from '../compliance-center';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { VIBER_TEMPLATES, type ViberTemplates } from './_shims/tokens';
import { AUDIENCE_LIMIT, progressPct } from './broadcast-rules';
import { ChannelsRepository } from './channels.repository';
import { mediaKindFor } from './viber-message';
import { VibBroadcastsRepository, type VibBroadcastRow } from './vib-broadcasts.repository';

const MODULE_KEY = 'viber_broadcasts';
const LIST_LIMIT = 50;

export interface VibBroadcastJob {
  orgId: number;
  broadcastId: number;
}

const refuse = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
) => new AppError(ERROR_CODES[code], message, status);

/**
 * Viber broadcasts (TW-VIB-010 to 014): the audience a channel can reach, composing a draft with a frozen recipient list, and the
 * operator's start, pause, retry and delete. The sending itself is `VibBroadcastSenderService`, run by a worker job.
 *
 * Difference from Reference: the send loop is a queue job, not an open browser tab, so closing the page no longer pauses it.
 */
@Injectable()
export class VibBroadcastsService {
  private readonly logger = new Logger(VibBroadcastsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: VibBroadcastsRepository,
    private readonly channels: ChannelsRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(VIBER_TEMPLATES) private readonly templates: ViberTemplates,
    @InjectQueue(QUEUES.VIBER_BROADCAST) private readonly queue: Queue<VibBroadcastJob>,
  ) {}

  private toResponse(r: VibBroadcastRow, held?: HeldSummary): VibBroadcast {
    return {
      id: r.uuid,
      name: r.name,
      channelId: r.channelUuid,
      channelName: r.channelName,
      templateId: r.templateUuid,
      status: r.status as VibBroadcast['status'],
      total: r.total,
      sent: r.sent,
      failed: r.failed,
      delivered: r.delivered,
      seen: r.seen,
      progress: progressPct(r.sent, r.failed, r.total),
      held: held?.count ?? 0,
      heldUntil: held?.next?.toISOString() ?? null,
      hasMedia: r.mediaPath !== null,
      lastError: r.lastError,
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** The users a channel carries (TW-VIB-010). */
  async users(channelUuid: string): Promise<ViberUserList> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const channel = await this.channels.findByUuid(tx, orgId, channelUuid);
      if (!channel) throw AppError.notFound('Viber channel', channelUuid);
      const rows = await this.repo.users(tx, orgId, channel.id, AUDIENCE_LIMIT);
      return {
        data: rows.map((u) => ({
          userId: u.userId,
          title: u.title,
          lastMessageAt: u.lastMessageAt?.toISOString() ?? null,
        })),
      };
    });
  }

  /** What the compose page opens with (TW-VIB-012). */
  async compose(): Promise<VibBroadcastCompose> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const channels = await this.channels.list(tx, orgId);
      const templates = await this.templates.list(tx, orgId);
      return {
        channels: channels.map((c) => ({ id: c.uuid, name: c.name, active: c.active })),
        templates: templates.map((t) => ({
          id: t.uuid,
          name: t.name,
          body: t.body,
          buttons: t.buttons,
        })),
      };
    });
  }

  /** The 50 newest broadcasts, with totals across all of them (TW-VIB-011). */
  async list(): Promise<VibBroadcastList> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, orgId, LIST_LIMIT);
      const stats = await this.repo.stats(tx, orgId);
      const held = await heldSummaries(
        tx,
        orgId,
        HELD_TABLES.viber,
        rows.map((r) => r.id),
      );
      return { data: rows.map((r) => this.toResponse(r, heldOf(held, r.id))), stats };
    });
  }

  async create(input: CreateVibBroadcastInput): Promise<VibBroadcast> {
    const ctx = RequestContextStore.require();

    return this.db.tx(async (tx) => {
      const channel = await this.channels.findByUuid(tx, ctx.orgId, input.channelId);
      if (!channel) throw AppError.notFound('Viber channel', input.channelId);

      const template = input.templateId
        ? await this.templates.find(tx, ctx.orgId, input.templateId)
        : undefined;
      if (input.templateId && !template) throw AppError.notFound('Template', input.templateId);

      const body = input.body || template?.body || '';
      if (body === '' && !input.mediaUrl) {
        throw refuse('VIB_BROADCAST_EMPTY', 'A broadcast needs a message, a file, or both.');
      }

      // Forged ids are dropped: only users this channel really carries can be picked.
      const audience = new Map(
        (await this.repo.users(tx, ctx.orgId, channel.id, AUDIENCE_LIMIT)).map((u) => [
          u.userId,
          u,
        ]),
      );
      const picked = [...new Set(input.userIds)]
        .map((id) => audience.get(id))
        .filter((u): u is NonNullable<typeof u> => u !== undefined);
      if (picked.length === 0) {
        throw refuse(
          'VIB_NO_RECIPIENTS',
          'None of those users belong to this channel. Pick recipients from the list.',
        );
      }

      const buttons = Array.isArray(template?.buttons) && template.buttons.length > 0;
      const id = await this.repo.insert(tx, ctx.orgId, {
        channelRowId: channel.id,
        userId: ctx.userId,
        name: input.name,
        templateId: template?.id ?? null,
        body: body === '' ? null : this.crypto.encrypt(body),
        buttons: buttons ? this.crypto.encrypt(JSON.stringify(template?.buttons)) : null,
        mediaPath: input.mediaUrl ?? null,
        mediaKind: input.mediaUrl ? mediaKindFor(input.mediaUrl) : null,
        mediaSize: input.mediaUrl ? (input.mediaSize ?? null) : null,
        total: picked.length,
      });
      await this.repo.insertRecipients(
        tx,
        ctx.orgId,
        id,
        picked.map((u) => ({ userId: u.userId, title: u.title, conversationId: u.conversationId })),
      );
      const row = await this.repo.findById(tx, ctx.orgId, id);
      if (!row) throw AppError.notFound('Viber broadcast', String(id));
      await this.audit.record(tx, { module: MODULE_KEY, recordId: id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: id,
        eventType: 'viber.broadcast.created',
        payload: { uuid: row.uuid, channel: channel.name, total: picked.length },
      });
      return this.toResponse(row);
    });
  }

  /** Draft to sending; the worker picks it up. Already sending is returned as it is. */
  async start(uuid: string): Promise<VibBroadcast> {
    const ctx = RequestContextStore.require();

    const { row, version } = await this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('Viber broadcast', uuid);
      if (found.status === 'sending') return { row: found, version: null };

      if ((await this.repo.pendingCount(tx, ctx.orgId, found.id)) === 0) {
        throw refuse('VIB_NOTHING_TO_SEND', 'Every recipient has already been handled.');
      }
      const channel = await this.channels.findById(tx, ctx.orgId, found.channelRowId);
      if (!channel?.active) {
        throw refuse(
          'VIB_CHANNEL_UNAVAILABLE',
          'The Viber channel for this broadcast is not connected/active.',
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
        eventType: 'viber.broadcast.started',
        payload: { uuid: found.uuid },
      });
      const fresh = await this.repo.findById(tx, ctx.orgId, found.id);
      return { row: fresh ?? found, version: next };
    });

    if (version !== null) await this.enqueue(ctx.orgId, row, version);
    return this.toResponse(row);
  }

  /** Back to draft: unsent users stay pending and the running job stops at its next batch. */
  async pause(uuid: string): Promise<VibBroadcast> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('Viber broadcast', uuid);
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
        eventType: 'viber.broadcast.paused',
        payload: { uuid: found.uuid },
      });
      const fresh = await this.repo.findById(tx, ctx.orgId, found.id);
      return this.toResponse(fresh ?? found);
    });
  }

  /** Failed users back to pending; the broadcast is a draft again, ready to start (Reference). */
  async retry(uuid: string): Promise<{ retried: number }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('Viber broadcast', uuid);
      if (found.status === 'sending') {
        throw refuse(
          'VIB_NOTHING_TO_RETRY',
          'This broadcast is still sending. Pause it or wait until it has finished.',
          HttpStatus.CONFLICT,
        );
      }
      const retried = await this.repo.resetFailed(tx, ctx.orgId, found.id);
      if (retried === 0)
        throw refuse('VIB_NOTHING_TO_RETRY', 'Nothing to retry — no recipient failed.');
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
        eventType: 'viber.broadcast.retry_requested',
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
      if (!found) throw AppError.notFound('Viber broadcast', uuid);
      await this.repo.remove(tx, ctx.orgId, found.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: found.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: found.id,
        eventType: 'viber.broadcast.deleted',
        payload: { uuid: found.uuid, status: found.status },
      });
    });
  }

  /** The row version names the job, so a pause then a start queues a fresh run instead of colliding with the finished one. */
  private async enqueue(orgId: number, row: VibBroadcastRow, version: number): Promise<void> {
    try {
      await this.queue.add(
        'send',
        { orgId, broadcastId: row.id },
        { jobId: `${row.uuid}-${version}`, removeOnComplete: 100, removeOnFail: 100 },
      );
    } catch (err) {
      // No job means nothing would ever send it: put it back to a draft so the operator can press Start again.
      this.logger.error({ orgId, broadcast: row.uuid, err }, 'could not queue viber broadcast');
      await this.db.txAs({ orgId }, (tx) => this.repo.setStatus(tx, orgId, row.id, 'draft'));
      throw refuse(
        'VIB_CHANNEL_UNAVAILABLE',
        'The send queue is unavailable. Try again in a moment.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
