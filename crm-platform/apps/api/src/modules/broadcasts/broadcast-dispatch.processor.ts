import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { QUEUES } from '../../infra/queue/queues';
import { BroadcastDispatchService } from './broadcast-dispatch.service';

export interface BroadcastDispatchJob {
  orgId: number;
  /** broadcasts.id: the job carries the id, the service re-reads everything it needs. */
  broadcastId: number;
}

/**
 * Sends one broadcast per job (TW-BCAST-016). Registered only in the worker process (BroadcastsWorkerModule, imported by
 * WorkersModule): the HTTP app never picks up a job.
 */
@Processor(QUEUES.BCAST_DISPATCH, { concurrency: 4 })
export class BroadcastDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(BroadcastDispatchProcessor.name);

  constructor(private readonly dispatch: BroadcastDispatchService) {
    super();
  }

  async process(job: Job<BroadcastDispatchJob>): Promise<string> {
    const { orgId, broadcastId } = job.data;
    return RequestContextStore.run(
      {
        requestId: `bcast-${broadcastId}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        try {
          return await this.dispatch.run(orgId, broadcastId);
        } catch (err) {
          // A rule the data broke will break again: do not retry it. Anything else (database, network) retries with backoff.
          if (err instanceof AppError) throw new UnrecoverableError(err.message);
          this.logger.error({ orgId, broadcastId, err }, '[BCAST] dispatch job crashed');
          throw err;
        }
      },
    );
  }
}
