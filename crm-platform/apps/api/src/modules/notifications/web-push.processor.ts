import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../../infra/queue/queues';
import { WebPushDeliveryService, type WebPushJob } from './web-push-delivery.service';

/**
 * Sends the browser pushes (worker process only). One job per bell row per person, enqueued by `NotificationPublisher` after the
 * row committed, so the outbox consumers never wait for a push service.
 *
 * A device the push service could not take right now (429, 5xx, network) makes the job fail so BullMQ retries it with exponential
 * backoff; the retry is narrowed to those devices, so a phone that already got the push does not get it twice. After the last attempt
 * the job is dropped quietly: a late push for a stale event is worse than none.
 */
@Processor(QUEUES.WEB_PUSH, { concurrency: 8 })
export class WebPushProcessor extends WorkerHost {
  private readonly logger = new Logger(WebPushProcessor.name);

  constructor(private readonly delivery: WebPushDeliveryService) {
    super();
  }

  async process(job: Job<WebPushJob>): Promise<void> {
    const outcome = await this.delivery.deliver(job.data);
    if (outcome.status !== 'done' || outcome.retry.length === 0) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade + 1 >= attempts) {
      this.logger.warn(
        { orgId: job.data.orgId, devices: outcome.retry.length },
        'web push gave up after the last attempt',
      );
      return;
    }
    await job.updateData({ ...job.data, only: outcome.retry });
    throw new Error(`web push: ${outcome.retry.length} device(s) to retry`);
  }
}
