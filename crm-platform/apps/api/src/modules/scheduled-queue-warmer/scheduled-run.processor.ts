import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { QUEUES } from '../../infra/queue/queues';
import { ScheduledRunService } from './scheduled-run.service';

const BUSY_RETRY_MS = 15_000;

export interface ScheduledRunJob {
  orgId: number;
  /** scheduled_messages.id: the job carries the id, the service re-reads everything it needs. */
  scheduledId: number;
}

/**
 * Runs one occurrence of a scheduled message per job (WD-NODE-030). Registered only in the worker process
 * (ScheduledQueueWarmerWorkerModule, imported by WorkersModule): the HTTP app never picks up a job.
 */
@Processor(QUEUES.SCHED_RUN, { concurrency: 4 })
export class ScheduledRunProcessor extends WorkerHost {
  private readonly logger = new Logger(ScheduledRunProcessor.name);

  constructor(private readonly runs: ScheduledRunService) {
    super();
  }

  async process(job: Job<ScheduledRunJob>, token?: string): Promise<string> {
    const { orgId, scheduledId } = job.data;
    return RequestContextStore.run(
      {
        requestId: `sched-${scheduledId}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        try {
          const result = await this.runs.run(orgId, scheduledId);
          if (result === 'busy') {
            // Another run is using this number: wait and try again, without using up a retry.
            await job.moveToDelayed(Date.now() + BUSY_RETRY_MS, token);
            throw new DelayedError();
          }
          return result;
        } catch (err) {
          if (err instanceof DelayedError) throw err;
          // A rule the data broke will break again: do not retry it. Anything else (database, network) retries with backoff.
          if (err instanceof AppError) throw new UnrecoverableError(err.message);
          this.logger.error({ orgId, scheduledId, err }, '[SCHED] run job crashed');
          throw err;
        }
      },
    );
  }
}
