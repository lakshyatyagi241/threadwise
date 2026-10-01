import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Readable } from 'node:stream';
import type { Queue } from 'bullmq';
import {
  DELETABLE_STATUSES,
  ERROR_CODES,
  type ResumeBroadcastResponse,
  type RetryBroadcastResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { SendPolicyService } from '../auth';
import { BroadcastProgressService } from './broadcast-progress.service';
import { deletedNotification } from './webhook-events';
import { CSV_HEADER, csvFileName, csvLine, csvRow } from './broadcast-csv';
import { BroadcastsRepository } from './broadcasts.repository';
import { BroadcastsReadRepository, type RecipientReadRow } from './broadcasts-read.repository';
import { assemblePhone } from './recipient-phone';
import { isKnownTimeZone } from './schedule';
import { WALLET_GATE, type WalletGate } from './_shims/tokens';
import type { BroadcastDispatchJob } from './broadcast-dispatch.processor';

const MODULE_KEY = 'broadcasts';
const EXPORT_PAGE = 1_000;
const refuse = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
) => new AppError(ERROR_CODES[code], message, status);

const csvName = (r: RecipientReadRow) =>
  r.contactName?.trim() ||
  [r.firstName, r.lastName].filter(Boolean).join(' ').trim() ||
  'Unknown contact';

/** What an operator does to an existing broadcast: delete it, retry its failures, export its recipients (TW-BCAST-037, 038, 040). */
@Injectable()
export class BroadcastsActionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: BroadcastsRepository,
    private readonly read: BroadcastsReadRepository,
    private readonly progress: BroadcastProgressService,
    private readonly sendPolicy: SendPolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(WALLET_GATE) private readonly wallet: WalletGate,
    @InjectQueue(QUEUES.BCAST_DISPATCH) private readonly queue: Queue<BroadcastDispatchJob>,
  ) {}

  /** Only a broadcast that has not started or that failed; a running or finished one keeps its history. */
  async delete(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.repo.lock(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Broadcast', uuid);
      if (!(DELETABLE_STATUSES as readonly string[]).includes(row.status)) {
        throw refuse('BCAST_NOT_DELETABLE', 'Only scheduled or failed broadcasts can be deleted.');
      }
      const snap = await this.progress.snapshot(tx, ctx.orgId, row.id);
      await this.repo.remove(tx, ctx.orgId, row.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'broadcast.deleted',
        payload: {
          uuid,
          status: row.status,
          ...(snap ? { notification: deletedNotification(snap.name) } : {}),
        },
      });
    });
    // Best effort, after the row is gone: a queued job for it is withdrawn, and one that already started finds nothing.
    await this.queue
      .getJob(uuid)
      .then((job) => job?.remove())
      .catch(() => undefined);
  }

  /**
   * Puts every failed recipient back to `pending` and makes the broadcast due again; recipients already delivered are not
   * touched, so nobody is messaged twice. Refused while the broadcast is running (Reference allowed a second concurrent loop),
   * and the send guards are checked again, which Reference did not.
   */
  async retryFailed(uuid: string): Promise<RetryBroadcastResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.lock(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Broadcast', uuid);
      if (row.status === 'processing' || row.status === 'scheduled') {
        throw refuse(
          'BCAST_NOT_RETRYABLE',
          'This broadcast is still running or waiting to run. Retry its failures once it has finished.',
          HttpStatus.CONFLICT,
        );
      }
      const failed = await this.repo.failedCount(tx, ctx.orgId, row.id);
      if (failed === 0)
        throw refuse('BCAST_NO_FAILED_RECIPIENTS', 'No failed recipients to retry.');

      await this.sendPolicy.screenBulk(ctx.orgId, '', { source: 'broadcast' });
      try {
        await this.wallet.precheck(ctx.orgId, failed);
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw refuse(
          'BCAST_SEND_BLOCKED',
          err instanceof Error ? err.message : 'The wallet cannot cover this send.',
        );
      }

      const retried = await this.repo.resetFailed(tx, ctx.orgId, row.id, false);
      await this.repo.reopen(tx, ctx.orgId, row.id, null);
      await this.progress.recompute(tx, ctx.orgId, row.id);
      await this.progress.setStatus(tx, ctx.orgId, row.id, 'processing');
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta: { status: { old: row.status, new: 'processing' } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'broadcast.retry_requested',
        payload: { uuid, retried, auto: false },
      });
      return { retried, status: 'processing' };
    });
  }

  /**
   * Starts a paused broadcast again: the unsent recipients are still `pending`, so the sender picks up where it stopped and
   * nobody is messaged twice. A pause that was a daily cap stops again at once if the cap is still reached.
   */
  async resume(uuid: string): Promise<ResumeBroadcastResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.lock(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Broadcast', uuid);
      if (row.status !== 'paused') {
        throw refuse(
          'BCAST_NOT_RESUMABLE',
          'Only a paused broadcast can be resumed.',
          HttpStatus.CONFLICT,
        );
      }
      await this.sendPolicy.screenBulk(ctx.orgId, '', { source: 'broadcast' });
      await this.progress.resume(tx, ctx.orgId, row.id);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta: { status: { old: 'paused', new: 'processing' } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'broadcast.resumed',
        payload: { uuid, auto: false },
      });
      return { status: 'processing' };
    });
  }

  /** The recipients as a CSV, streamed page by page so a big broadcast is never held in memory. */
  async export(uuid: string): Promise<{ stream: Readable; fileName: string }> {
    const ctx = RequestContextStore.require();
    const b = await this.db.tx(async (tx) => {
      const row = await this.read.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Broadcast', uuid);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: row.id, action: 'export' });
      return row;
    });
    // Times are read in the broadcast's own zone, the same as the detail page (Reference used the workspace zone here).
    const zone = b.timezone && isKnownTimeZone(b.timezone) ? b.timezone : 'UTC';
    const page = (cursor: string | undefined) =>
      RequestContextStore.run(ctx, () =>
        this.db.tx((tx) =>
          this.read.recipients(tx, ctx.orgId, b.id, { limit: EXPORT_PAGE, cursor }),
        ),
      );

    async function* lines() {
      yield csvLine(CSV_HEADER);
      let cursor: string | undefined;
      for (;;) {
        const rows = await page(cursor);
        const { items, page: info } = buildPage(rows, EXPORT_PAGE);
        for (const r of items) {
          yield csvRow(
            {
              name: csvName(r),
              phoneDigits: assemblePhone(r.phone, r.countryCode),
              status: r.status,
              clicked: r.clicks > 0,
              queuedAt: r.createdAt,
              sentAt: r.sentAt,
              deliveredAt: r.deliveredAt,
              readAt: r.readAt,
              failedAt: r.status === 'failed' ? r.updatedAt : null,
              error: r.error,
            },
            zone,
          );
        }
        if (!info.hasMore) return;
        cursor = info.nextCursor ?? undefined;
      }
    }
    return { stream: Readable.from(lines()), fileName: csvFileName(uuid, new Date()) };
  }
}
