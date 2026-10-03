import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { QUEUES } from '../../infra/queue/queues';
import { BroadcastService, type BroadcastJob } from './broadcast.service';
import { CartService, type CartStepJob } from './cart.service';
import { WebhookPipelineService, type WebhookJob } from './webhook-pipeline.service';

/** Runs one verified store delivery (WD-ECOM-008, 010, 027). Registered only in the worker process. */
@Processor(QUEUES.ECOM_WEBHOOK, { concurrency: 5 })
export class EcomWebhookProcessor extends WorkerHost {
  constructor(
    private readonly pipeline: WebhookPipelineService,
    private readonly cart: CartService,
    private readonly broadcasts: BroadcastService,
  ) {
    super();
  }

  process(job: Job<WebhookJob | CartStepJob | BroadcastJob>): Promise<void> {
    const { orgId, kind, storeId } = job.data;
    return RequestContextStore.run(
      {
        requestId: `ecom-webhook-${kind}-${storeId}-${job.id ?? ''}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => {
        if (job.name === 'cart-step') return this.cart.runStep(job.data as CartStepJob);
        if (job.name === 'broadcast') return this.broadcasts.run(job.data as BroadcastJob);
        return this.pipeline.run(job.data as WebhookJob);
      },
    );
  }
}
