import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { QUEUES } from '../../infra/queue/queues';
import { BackfillService, type BackfillResult } from './backfill.service';
import type { BackfillJob } from './pages.service';

/**
 * Imports one Page's past Messenger threads (WD-FB-010). Registered only in the worker process (ChannelFacebookWorkerModule, imported
 * by WorkersModule): the HTTP app queues the job and never runs it. A retry is safe because every message is stored once by its Meta id.
 */
@Processor(QUEUES.FB_BACKFILL, { concurrency: 2 })
export class FbBackfillProcessor extends WorkerHost {
  private readonly logger = new Logger(FbBackfillProcessor.name);

  constructor(private readonly backfill: BackfillService) {
    super();
  }

  process(job: Job<BackfillJob>): Promise<BackfillResult> {
    const { orgId, pageRowId } = job.data;
    return RequestContextStore.run(
      {
        requestId: `fb-backfill-${pageRowId}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        try {
          return await this.backfill.run(orgId, pageRowId);
        } catch (err) {
          this.logger.error({ orgId, pageRowId, err }, '[FB] backfill job crashed');
          throw err;
        }
      },
    );
  }
}
