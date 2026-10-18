import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { send } from './send';
import { RetryAfterError, webhookBackoffStrategy, type WebhookDeliveryJob } from './webhook-job';
import { WebhooksRepository } from './webhooks.repository';

/**
 * Makes one delivery attempt and logs it. A failure is retried by the queue (exponential backoff) until the attempts run out or the
 * answer can never improve (a 4xx other than 408/429, a blocked address); then the endpoint is marked failing. Every attempt is a
 * row in the delivery log, which is how a customer sees what their server answered. Registered only in the worker process.
 */
@Processor(QUEUES.WEBHOOK_DELIVER, {
  concurrency: 16,
  settings: { backoffStrategy: webhookBackoffStrategy },
})
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WebhooksRepository,
    private readonly crypto: CryptoService,
  ) {
    super();
  }

  async process(job: Job<WebhookDeliveryJob>): Promise<{ statusCode: number | null }> {
    const { orgId, webhookId, envelope } = job.data;
    const target = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.findById(tx, orgId, webhookId),
    );
    // Deleted or switched off while queued: nothing to send to.
    if (!target || !target.status) return { statusCode: null };

    const secret = target.secret ? this.crypto.decrypt(target.secret) : null;
    const out = await send(this.crypto.decrypt(target.webhookUrl), secret, envelope);
    const attempt = job.attemptsMade + 1;
    const final = out.ok || out.permanent || attempt >= (job.opts.attempts ?? 1);

    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      await this.repo.logDelivery(tx, orgId, {
        webhookId,
        event: envelope.event,
        statusCode: out.statusCode,
        latencyMs: out.latencyMs,
        attempts: attempt,
        isRetry: attempt > 1,
        payload: envelope,
        responseBody: out.responseSnippet,
        error: out.error,
      });
      await this.repo.recordResult(tx, orgId, webhookId, {
        ok: out.ok,
        final,
        statusCode: out.statusCode,
        latencyMs: out.latencyMs,
        error: out.error,
      });
    });

    if (out.ok) return { statusCode: out.statusCode };
    if (final) {
      this.logger.warn(
        { webhookId, statusCode: out.statusCode, error: out.error, attempt },
        'webhook delivery failed for good',
      );
      throw new UnrecoverableError(out.error ?? 'delivery failed');
    }
    if (out.retryAfterMs !== null)
      throw new RetryAfterError(out.error ?? 'delivery failed', out.retryAfterMs);
    throw new Error(out.error ?? 'delivery failed');
  }
}
