import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { QUEUES } from '../../infra/queue/queues';
import { FbBroadcastSenderService } from './fb-broadcast-sender.service';
import type { FbBroadcastJob } from './fb-broadcasts.service';

/**
 * Sends one Messenger broadcast per job (TW-FB-013). Registered only in the worker process (ChannelFacebookWorkerModule, imported by
 * WorkersModule): the HTTP app never picks up a job. A retry after a crash is safe: sent people are not pending any more.
 */
@Processor(QUEUES.FB_BROADCAST, { concurrency: 2 })
export class FbBroadcastProcessor extends WorkerHost {
  private readonly logger = new Logger(FbBroadcastProcessor.name);

  constructor(private readonly sender: FbBroadcastSenderService) {
    super();
  }

  process(job: Job<FbBroadcastJob>): Promise<string> {
    const { orgId, broadcastId } = job.data;
    return RequestContextStore.run(
      {
        requestId: `fb-bcast-${broadcastId}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        try {
          return await this.sender.run(orgId, broadcastId);
        } catch (err) {
          if (err instanceof AppError) throw new UnrecoverableError(err.message);
          this.logger.error({ orgId, broadcastId, err }, '[FB] broadcast job crashed');
          throw err;
        }
      },
    );
  }
}
