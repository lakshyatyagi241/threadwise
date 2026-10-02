import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { QUEUES } from '../../infra/queue/queues';
import { WebhookPipelineService, type WebhookJob } from './webhook-pipeline.service';

/** Runs one verified store delivery (WD-ECOM-008, 010, 027). Registered only in the worker process. */
@Processor(QUEUES.ECOM_WEBHOOK, { concurrency: 5 })
export class EcomWebhookProcessor extends WorkerHost {
  constructor(private readonly pipeline: WebhookPipelineService) {
    super();
  }

  process(job: Job<WebhookJob>): Promise<void> {
    const { orgId, kind, storeId } = job.data;
    return RequestContextStore.run(
      {
        requestId: `ecom-webhook-${kind}-${storeId}-${job.id ?? ''}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.pipeline.run(job.data),
    );
  }
}
