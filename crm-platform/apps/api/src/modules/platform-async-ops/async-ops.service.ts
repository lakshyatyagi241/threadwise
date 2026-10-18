import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type {
  DeadOutboxGroup,
  FailedIngestJob,
  OutboxReplayRequest,
  OutboxReplayResult,
  WabaReplayRequest,
  WabaReplayResult,
} from '@crm/contracts';
import { QUEUES } from '../../infra/queue/queues';
import { AuthAuditService } from '../auth';
import { FailedOperationsService, FailureRecorder } from '../failed-operations';
import { AsyncOpsStore } from './async-ops.store';

const REASON_MAX = 300;
const cut = (s: unknown): string | null =>
  s === null || s === undefined || s === '' ? null : String(s).slice(0, REASON_MAX);

/**
 * Operator tools for work that ran out of retries (ASYNC-041, 044, 045, 046, 050).
 *
 * - Replay only re-queues what is already stored. The caller names a type and a count, never a payload, so replay cannot be used to
 *   inject work.
 * - Replay of an outbox event flips `dead` to `pending` in one statement that locks the rows it takes (`FOR UPDATE SKIP LOCKED`), so
 *   two operators, or a double click, never replay the same event twice at once; a second call finds nothing left.
 * - Events of a workspace that is suspended or deleted stay dead: the authority to act for it is gone (ASYNC-046). A WhatsApp payload is
 *   re-routed from its phone number when the worker processes it, so a replayed job reaches the workspace that owns the number now.
 * - Replay keeps the events' own order among themselves (oldest first) but cannot put them before events of the same record that were
 *   processed meanwhile: consumers must apply state forward-only or by upsert (ASYNC-062), as the idempotency audit requires.
 * - Consumers are at-least-once already (the billing charge, the message ledger and the webhook ledger deduplicate), which is what makes
 *   a replay safe to repeat (ASYNC-045).
 * - Replay keeps `last_error` (the evidence of why the event died) until the next failure overwrites it; it never clears it.
 * - Every replay is recorded in the security events with the operator, the type, the counts and the first 100 event ids.
 * - The two queue replays (waba-ingest, webhook-retry) go through the failed-operation record and its eligibility check, not `job.retry`.
 */
@Injectable()
export class AsyncOpsService {
  constructor(
    private readonly store: AsyncOpsStore,
    @InjectQueue(QUEUES.WABA_INGEST) private readonly wabaIngest: Queue,
    @InjectQueue(QUEUES.WEBHOOK_RETRY) private readonly webhookRetry: Queue,
    private readonly audit: AuthAuditService,
    private readonly recorder: FailureRecorder,
    private readonly failedOps: FailedOperationsService,
  ) {}

  async deadOutbox(): Promise<DeadOutboxGroup[]> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT event_type, count(*)::int AS n, min(created_at) AS oldest, max(last_error) AS last_error
        FROM event_outbox
        WHERE status = 'dead'
        GROUP BY event_type
        ORDER BY count(*) DESC
        LIMIT 100
      `);
      return (
        res.rows as Array<{
          event_type: string;
          n: number;
          oldest: Date;
          last_error: string | null;
        }>
      ).map((r) => ({
        eventType: r.event_type,
        count: Number(r.n),
        oldestAt: new Date(r.oldest).toISOString(),
        lastError: cut(r.last_error),
      }));
    });
  }

  async replayOutbox(req: OutboxReplayRequest, operatorId: number): Promise<OutboxReplayResult> {
    return this.store.tx(async (tx) => {
      const replayed = await tx.execute(sql`
        WITH picked AS (
          SELECT o.id, o.created_at
          FROM event_outbox o
          WHERE o.status = 'dead'
            AND o.event_type = ${req.eventType}
            AND EXISTS (
              SELECT 1 FROM organizations g WHERE g.id = o.org_id AND g.status = 'active'
            )
          ORDER BY o.created_at, o.id
          LIMIT ${req.limit}
          FOR UPDATE OF o SKIP LOCKED
        )
        UPDATE event_outbox o
        SET status = 'pending', attempts = 0, available_at = now()
        FROM picked
        WHERE o.id = picked.id AND o.created_at = picked.created_at
        RETURNING o.id
      `);
      const left = await tx.execute(sql`
        SELECT count(*)::int AS n
        FROM event_outbox o
        WHERE o.status = 'dead'
          AND o.event_type = ${req.eventType}
          AND NOT EXISTS (SELECT 1 FROM organizations g WHERE g.id = o.org_id AND g.status = 'active')
      `);
      const result: OutboxReplayResult = {
        replayed: replayed.rows.length,
        skippedInactiveWorkspace: Number((left.rows[0] as { n?: number } | undefined)?.n ?? 0),
      };
      await this.audit.record(tx, {
        event: 'platform.async_ops.outbox_replayed',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          eventType: req.eventType,
          limit: req.limit,
          ...result,
          eventIds: replayed.rows.slice(0, 100).map((r) => String((r as { id: unknown }).id)),
        },
      });
      return result;
    });
  }

  failedWaba(limit: number): Promise<FailedIngestJob[]> {
    return this.listFailed(this.wabaIngest, limit);
  }

  replayWaba(req: WabaReplayRequest, operatorId: number): Promise<WabaReplayResult> {
    return this.replayFailed(
      this.wabaIngest,
      QUEUES.WABA_INGEST,
      'waba_ingest_replayed',
      req.limit,
      operatorId,
    );
  }

  failedWebhookRetry(limit: number): Promise<FailedIngestJob[]> {
    return this.listFailed(this.webhookRetry, limit);
  }

  replayWebhookRetry(req: WabaReplayRequest, operatorId: number): Promise<WabaReplayResult> {
    return this.replayFailed(
      this.webhookRetry,
      QUEUES.WEBHOOK_RETRY,
      'webhook_retry_replayed',
      req.limit,
      operatorId,
    );
  }

  private async listFailed(queue: Queue, limit: number): Promise<FailedIngestJob[]> {
    const jobs = await queue.getFailed(0, Math.max(0, limit - 1));
    return jobs.map((j) => ({
      jobId: String(j.id ?? ''),
      attemptsMade: j.attemptsMade,
      failedReason: cut(j.failedReason),
      failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
    }));
  }

  /**
   * The bulk replay of the two queues that existed before the failed-operation record. It no longer retries a job in the queue: each
   * failed job is recorded (idempotently) and redriven through the same eligibility check as a single redrive, so the attempt
   * history is kept, the replay count is bounded, a suspended workspace is refused, and a job that failed on purpose is left alone.
   */
  private async replayFailed(
    queue: Queue,
    queueName: string,
    auditName: string,
    limit: number,
    operatorId: number,
  ): Promise<WabaReplayResult> {
    const jobs = await queue.getFailed(0, limit - 1);
    let replayed = 0;
    let skipped = 0;
    const ids: string[] = [];
    for (const job of jobs) {
      try {
        // A job in the failed set is final; a count below its limit means it skipped its attempts (UnrecoverableError).
        const rec = await this.recorder.record(
          queueName,
          job,
          job.attemptsMade < (job.opts?.attempts ?? 1),
        );
        if (!rec.uuid) {
          skipped += 1;
          continue;
        }
        const out = await this.failedOps.redrive(rec.uuid, operatorId, false);
        if (!out.redriven) {
          skipped += 1;
          continue;
        }
        replayed += 1;
        ids.push(rec.uuid);
        // The record owns the work now; leaving the old job in the failed set would count it twice on the health page.
        await job.remove().catch(() => undefined);
      } catch {
        // No longer failed, or the record could not be written: not an error for the rest.
        skipped += 1;
      }
    }
    await this.store.tx((tx) =>
      this.audit.record(tx, {
        event: `platform.async_ops.${auditName}`,
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { limit, replayed, skipped, failedOperations: ids.slice(0, 100) },
      }),
    );
    return { replayed, skipped };
  }
}
