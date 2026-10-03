import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ERROR_CODES,
  type CreateFbBroadcastInput,
  type FbBroadcast,
  type FbBroadcastCompose,
  type FbBroadcastList,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  FACEBOOK_PLAN_GATE,
  FACEBOOK_TEMPLATES,
  type FacebookPlanGate,
  type FacebookTemplates,
} from './_shims/tokens';
import { AUDIENCE_LIMIT, progressPct, windowCutoff } from './broadcast-rules';
import { FbBroadcastsRepository, type FbBroadcastRow } from './fb-broadcasts.repository';
import { PagesRepository } from './pages.repository';

const MODULE_KEY = 'facebook_broadcasts';
const LIST_LIMIT = 50;

export interface FbBroadcastJob {
  orgId: number;
  broadcastId: number;
}

const refuse = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
) => new AppError(ERROR_CODES[code], message, status);

/**
 * Messenger broadcasts (WD-FB-012 to 014): the audience a Page can reach, composing a draft with a frozen recipient list, and the
 * operator's start, pause, retry and delete. The sending itself is `FbBroadcastSenderService`, run by a worker job.
 *
 * Difference from WaDesk: the send loop is a queue job, not an open browser tab, so closing the page no longer pauses it.
 */
@Injectable()
export class FbBroadcastsService {
  private readonly logger = new Logger(FbBroadcastsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FbBroadcastsRepository,
    private readonly pages: PagesRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(FACEBOOK_PLAN_GATE) private readonly plan: FacebookPlanGate,
    @Inject(FACEBOOK_TEMPLATES) private readonly templates: FacebookTemplates,
    @InjectQueue(QUEUES.FB_BROADCAST) private readonly queue: Queue<FbBroadcastJob>,
  ) {}

  private toResponse(r: FbBroadcastRow): FbBroadcast {
    return {
      id: r.uuid,
      name: r.name,
      pageId: r.pageUuid,
      pageName: r.pageName,
      templateId: r.templateUuid,
      status: r.status as FbBroadcast['status'],
      total: r.total,
      sent: r.sent,
      failed: r.failed,
      blocked: r.blocked,
      progress: progressPct(r.sent, r.failed, r.blocked, r.total),
      lastError: r.lastError,
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** What the compose form opens with (WD-FB-012): each connected Page with who it can message right now, and the templates. */
  async compose(): Promise<FbBroadcastCompose> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    return this.db.tx(async (tx) => {
      const cutoff = windowCutoff(new Date());
      const connected = (await this.pages.list(tx, orgId)).filter((p) => p.status === 'connected');
      const pages = [];
      for (const p of connected) {
        const audience = await this.repo.audience(tx, orgId, p.pageId, cutoff, AUDIENCE_LIMIT);
        pages.push({
          id: p.uuid,
          pageId: p.pageId,
          name: p.name,
          audience: audience.map((a) => ({
            psid: a.psid,
            title: a.title,
            lastInboundAt: a.lastInboundAt.toISOString(),
          })),
        });
      }
      const templates = await this.templates.list(tx, orgId);
      return {
        pages,
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
  async list(): Promise<FbBroadcastList> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertChannel(orgId);
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, orgId, LIST_LIMIT);
      const stats = await this.repo.stats(tx, orgId);
      return { data: rows.map((r) => this.toResponse(r)), stats };
    });
  }

  async create(input: CreateFbBroadcastInput): Promise<FbBroadcast> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);

    return this.db.tx(async (tx) => {
      const page = await this.pages.findByUuid(tx, ctx.orgId, input.pageId);
      if (!page || page.status !== 'connected') {
        throw refuse('FB_PAGE_UNAVAILABLE', 'Pick a connected Facebook Page.');
      }

      // WaDesk ignored a template that was not a Facebook template of this workspace; so does this.
      const template = input.templateId
        ? await this.templates.find(tx, ctx.orgId, input.templateId)
        : undefined;
      const body = input.body || template?.body || '';
      if (body === '') throw refuse('FB_BROADCAST_EMPTY', 'A broadcast needs a message.');

      // Forged ids are dropped: only people this Page can reach inside the window can be picked.
      const audience = new Map(
        (
          await this.repo.audience(
            tx,
            ctx.orgId,
            page.pageId,
            windowCutoff(new Date()),
            AUDIENCE_LIMIT,
          )
        ).map((a) => [a.psid, a]),
      );
      const picked = [...new Set(input.psids)]
        .map((id) => audience.get(id))
        .filter((a): a is NonNullable<typeof a> => a !== undefined);
      if (picked.length === 0) {
        throw refuse(
          'FB_NO_RECIPIENTS',
          'None of those recipients are within the 24-hour window. Pick from the list.',
        );
      }

      const buttons = Array.isArray(template?.buttons) && template.buttons.length > 0;
      const id = await this.repo.insert(tx, ctx.orgId, {
        pageRowId: page.id,
        userId: ctx.userId,
        name: input.name,
        templateId: template?.id ?? null,
        body: this.crypto.encrypt(body),
        buttons: buttons ? this.crypto.encrypt(JSON.stringify(template?.buttons)) : null,
        total: picked.length,
      });
      await this.repo.insertRecipients(
        tx,
        ctx.orgId,
        id,
        picked.map((a) => ({ psid: a.psid, title: a.title, conversationId: a.conversationId })),
      );
      const row = await this.repo.findById(tx, ctx.orgId, id);
      if (!row) throw AppError.notFound('Facebook broadcast', String(id));
      await this.audit.record(tx, { module: MODULE_KEY, recordId: id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: id,
        eventType: 'facebook.broadcast.created',
        payload: { uuid: row.uuid, page: page.pageId, total: picked.length },
      });
      return this.toResponse(row);
    });
  }

  /** Draft to sending; the worker picks it up. Already sending is returned as it is. */
  async start(uuid: string): Promise<FbBroadcast> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);

    const { row, version } = await this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('Facebook broadcast', uuid);
      if (found.status === 'sending') return { row: found, version: null };

      const page = await this.pages.findById(tx, ctx.orgId, found.pageRowId);
      if (!page || page.status !== 'connected') {
        throw refuse(
          'FB_PAGE_UNAVAILABLE',
          'The Page this broadcast was built for is no longer connected.',
        );
      }
      if ((await this.repo.pendingCount(tx, ctx.orgId, found.id)) === 0) {
        throw refuse(
          'FB_NOTHING_TO_SEND',
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
        eventType: 'facebook.broadcast.started',
        payload: { uuid: found.uuid },
      });
      const fresh = await this.repo.findById(tx, ctx.orgId, found.id);
      return { row: fresh ?? found, version: next };
    });

    if (version !== null) await this.enqueue(ctx.orgId, row, version);
    return this.toResponse(row);
  }

  /** Back to draft: unsent people stay pending and the running job stops at its next batch. */
  async pause(uuid: string): Promise<FbBroadcast> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);
    return this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('Facebook broadcast', uuid);
      // WaDesk paused whatever the status; only a running send has anything to stop, so any other is returned as it is.
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
        eventType: 'facebook.broadcast.paused',
        payload: { uuid: found.uuid },
      });
      const fresh = await this.repo.findById(tx, ctx.orgId, found.id);
      return this.toResponse(fresh ?? found);
    });
  }

  /** Failed people back to pending (blocked stay blocked); the broadcast is a draft again, ready to start. */
  async retry(uuid: string): Promise<{ retried: number }> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);
    return this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('Facebook broadcast', uuid);
      if (found.status === 'sending') {
        throw refuse(
          'FB_NOTHING_TO_RETRY',
          'This broadcast is still sending. Pause it or wait until it has finished.',
          HttpStatus.CONFLICT,
        );
      }
      const retried = await this.repo.resetFailed(tx, ctx.orgId, found.id);
      if (retried === 0) throw refuse('FB_NOTHING_TO_RETRY', 'No failed recipients to retry.');
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
        eventType: 'facebook.broadcast.retry_requested',
        payload: { uuid: found.uuid, retried },
      });
      return { retried };
    });
  }

  /** Any status, including sending: a job that is mid-run finds nothing at its next batch and stops. */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.plan.assertChannel(ctx.orgId);
    await this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('Facebook broadcast', uuid);
      await this.repo.remove(tx, ctx.orgId, found.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: found.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: found.id,
        eventType: 'facebook.broadcast.deleted',
        payload: { uuid: found.uuid, status: found.status },
      });
    });
  }

  /** The row version names the job, so a pause then a start queues a fresh run instead of colliding with the finished one. */
  private async enqueue(orgId: number, row: FbBroadcastRow, version: number): Promise<void> {
    try {
      await this.queue.add(
        'send',
        { orgId, broadcastId: row.id },
        { jobId: `${row.uuid}-${version}`, removeOnComplete: 100, removeOnFail: 100 },
      );
    } catch (err) {
      // No job means nothing would ever send it: put it back to a draft so the operator can press Start again.
      this.logger.error({ orgId, broadcast: row.uuid, err }, 'could not queue facebook broadcast');
      await this.db.txAs({ orgId }, (tx) => this.repo.setStatus(tx, orgId, row.id, 'draft'));
      throw refuse(
        'FB_PAGE_UNAVAILABLE',
        'The send queue is unavailable. Try again in a moment.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
