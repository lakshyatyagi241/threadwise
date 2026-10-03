import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { QUEUES } from '../../infra/queue/queues';
import { PullService, type PullJob, type PullResult } from './pull.service';

/**
 * Pulls one organization's new Instagram messages (WD-IG-009). Registered only in the worker process
 * (ChannelInstagramWorkerModule, imported by WorkersModule): the HTTP app never runs it. A retry is safe because every message is
 * stored once by the engine's id.
 */
@Processor(QUEUES.IG_PULL, { concurrency: 4 })
export class IgPullProcessor extends WorkerHost {
  private readonly logger = new Logger(IgPullProcessor.name);

  constructor(private readonly pull: PullService) {
    super();
  }

  process(job: Job<PullJob>): Promise<PullResult> {
    const { orgId, force } = job.data;
    return RequestContextStore.run(
      {
        requestId: `ig-pull-${orgId}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        try {
          return await this.pull.pull(orgId, force === true);
        } catch (err) {
          this.logger.error({ orgId, err }, '[IG] pull job crashed');
          throw err;
        }
      },
    );
  }
}
