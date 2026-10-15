import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { QUEUES } from '../../infra/queue/queues';
import { LineBroadcastSenderService } from './line-broadcast-sender.service';
import type { LineBroadcastJob } from './line-broadcasts.service';

/**
 * Sends one LINE broadcast per job. Registered only in the worker process (ChannelLineWorkerModule, imported by WorkersModule): the
 * HTTP app never picks up a job. A retry after a crash is safe: people already sent are not pending any more.
 */
@Processor(QUEUES.LINE_BROADCAST, { concurrency: 2 })
export class LineBroadcastProcessor extends WorkerHost {
  private readonly logger = new Logger(LineBroadcastProcessor.name);

  constructor(private readonly sender: LineBroadcastSenderService) {
    super();
  }

  process(job: Job<LineBroadcastJob>): Promise<string> {
    const { orgId, broadcastId } = job.data;
    return RequestContextStore.run(
      {
        requestId: `line-bcast-${broadcastId}`,
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
          this.logger.error({ orgId, broadcastId, err }, '[LINE] broadcast job crashed');
          throw err;
        }
      },
    );
  }
}
