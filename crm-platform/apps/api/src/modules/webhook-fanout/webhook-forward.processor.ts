import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { UnrecoverableError, type Job } from 'bullmq';
import { QUEUES } from '../../infra/queue/queues';
import { PlatformStore } from '../auth';
import { deliver } from './deliver';
import type { ForwardJob } from './webhook-fanout.rules';
import { WebhookTargetsRepository } from './webhook-targets.repository';

interface Tally {
  ok: number;
  failed: number;
  lastStatus: number | null;
  lastError: string | null;
  okAt: Date | null;
  failAt: Date | null;
}

/**
 * Delivers queued webhook copies. Registered only in the worker process (WebhookFanoutWorkerModule).
 *
 * Counters are tallied in memory and written every few seconds, one UPDATE per target, so a burst of webhooks is not a
 * burst of writes to the same row. A delivery that is out of retries (or can never succeed) is kept, body included,
 * in `webhook_forward_failures` so an operator can replay it; successes leave no row.
 */
@Processor(QUEUES.WEBHOOK_FORWARD, { concurrency: 16 })
export class WebhookForwardProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(WebhookForwardProcessor.name);
  private tallies = new Map<number, Tally>();
  private flushing = false;

  constructor(
    private readonly targets: WebhookTargetsRepository,
    private readonly store: PlatformStore,
  ) {
    super();
  }

  async process(job: Job<ForwardJob>): Promise<{ statusCode: number | null }> {
    const { targetId, signatureHeader, contentType } = job.data;
    const target = await this.targets.deliveryTarget(targetId);
    // Deleted or switched off while queued: drop it quietly, there is nowhere to send it.
    if (!target) return { statusCode: null };

    const body = Buffer.from(job.data.body, 'base64');
    const out = await deliver(target, { body, signatureHeader, contentType });
    if (out.ok) {
      this.tally(targetId, true, out.statusCode, null);
      return { statusCode: out.statusCode };
    }

    const attempts = job.attemptsMade + 1;
    const exhausted = attempts >= (job.opts.attempts ?? 1);
    this.tally(targetId, false, out.statusCode, out.error);
    if (exhausted || out.permanent) {
      await this.keepFailure(targetId, job.data, body, attempts, out.statusCode, out.error);
      this.logger.warn(
        { targetId, statusCode: out.statusCode, error: out.error, attempts },
        'webhook forward failed for good',
      );
      throw new UnrecoverableError(out.error ?? 'delivery failed');
    }
    throw new Error(out.error ?? 'delivery failed');
  }

  private tally(id: number, ok: boolean, status: number | null, error: string | null): void {
    const t = this.tallies.get(id) ?? {
      ok: 0,
      failed: 0,
      lastStatus: null,
      lastError: null,
      okAt: null,
      failAt: null,
    };
    if (ok) {
      t.ok += 1;
      t.okAt = new Date();
    } else {
      t.failed += 1;
      t.failAt = new Date();
      t.lastError = error;
    }
    t.lastStatus = status;
    this.tallies.set(id, t);
  }

  @Interval(5_000)
  async flush(): Promise<void> {
    if (this.flushing || this.tallies.size === 0) return;
    this.flushing = true;
    const batch = this.tallies;
    this.tallies = new Map();
    try {
      await this.store.tx(async (tx) => {
        for (const [id, t] of batch) {
          await tx.execute(sql`
            UPDATE webhook_forward_targets SET
              success_count = success_count + ${t.ok},
              failure_count = failure_count + ${t.failed},
              last_status = ${t.lastStatus},
              last_error = CASE WHEN ${t.failed} > 0 THEN ${t.lastError} WHEN ${t.ok} > 0 THEN NULL ELSE last_error END,
              last_success_at = COALESCE(${t.okAt}::timestamptz, last_success_at),
              last_failure_at = COALESCE(${t.failAt}::timestamptz, last_failure_at)
            WHERE id = ${id}
          `);
        }
      });
    } catch (err) {
      // Counters are best effort: put them back for the next flush rather than lose them.
      for (const [id, t] of batch) {
        const cur = this.tallies.get(id);
        if (!cur) this.tallies.set(id, t);
        else {
          cur.ok += t.ok;
          cur.failed += t.failed;
        }
      }
      this.logger.error({ err: (err as Error).message }, 'webhook forward counter flush failed');
    } finally {
      this.flushing = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }

  private async keepFailure(
    targetId: number,
    data: ForwardJob,
    body: Buffer,
    attempts: number,
    statusCode: number | null,
    error: string | null,
  ): Promise<void> {
    try {
      await this.store.tx((tx) =>
        tx.execute(sql`
          INSERT INTO webhook_forward_failures (target_id, body, signature_header, content_type, attempts, status_code, error)
          VALUES (${targetId}, ${body}, ${data.signatureHeader}, ${data.contentType}, ${attempts}, ${statusCode}, ${error})
        `),
      );
    } catch (err) {
      this.logger.error(
        { targetId, err: (err as Error).message },
        'could not keep failed webhook forward',
      );
    }
  }
}
