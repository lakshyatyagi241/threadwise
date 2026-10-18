import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { AppError } from '../../common/errors/app-error';
import { QUEUES } from '../../infra/queue/queues';
import { WebhookRetryService, type WebhookRetryJob } from './webhook-retry.service';

/** Works the webhook retry queue. Registered only in the worker process (WebhookRetryWorkerModule). */
@Processor(QUEUES.WEBHOOK_RETRY, { concurrency: 4 })
export class WebhookRetryProcessor extends WorkerHost {
  constructor(private readonly retry: WebhookRetryService) {
    super();
  }

  async process(job: Job<WebhookRetryJob>): Promise<void> {
    try {
      await this.retry.run(job.data.channel, job.data.sealed);
    } catch (err) {
      // A rule the data broke fails the same way every time; anything else (database, redis, provider) retries with backoff.
      if (err instanceof AppError) throw new UnrecoverableError(err.message);
      throw err;
    }
  }
}
