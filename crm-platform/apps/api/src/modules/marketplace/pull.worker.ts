import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import type { Job, Queue } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { PullRunService, type PullOutcome } from './pull-run.service';
import { PullStateRepository } from './pull-state.repository';

export interface PullJob {
  orgId: number;
  connectionId: number;
}

/** How long a delivery row is kept for the connection page's "recent events". The lead itself lives in the lead pipeline. */
export const EVENT_RETENTION_DAYS = 30;

/**
 * Every 30 seconds, one `mkt-pull` job per pull connection that is due. The job id is the connection, so a poll that is still running or
 * waiting is never queued a second time. Registered only in the worker process (MarketplaceWorkerModule, imported by WorkersModule).
 */
@Injectable()
export class PullSweepService {
  private readonly logger = new Logger(PullSweepService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly state: PullStateRepository,
    @InjectQueue(QUEUES.MKT_PULL) private readonly queue: Queue<PullJob>,
  ) {}

  @Cron('*/30 * * * * *')
  async run(): Promise<number> {
    const due = await this.db.privileged((tx) => this.state.due(tx, 200));
    let queued = 0;
    for (const d of due) {
      try {
        await this.queue.add('pull', d, {
          jobId: `mkt-pull-${d.connectionId}`,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        });
        queued += 1;
      } catch (err) {
        this.logger.error({ err, ...d }, 'marketplace pull not queued');
      }
    }
    return queued;
  }

  /** Hourly: delivery rows past their retention go. */
  @Cron('17 * * * *')
  async trim(): Promise<number> {
    return this.db.privileged((tx) => this.state.trimEvents(tx, EVENT_RETENTION_DAYS));
  }
}

@Processor(QUEUES.MKT_PULL, { concurrency: 4 })
export class PullProcessor extends WorkerHost {
  constructor(private readonly runner: PullRunService) {
    super();
  }

  process(job: Job<PullJob>): Promise<PullOutcome> {
    const { orgId, connectionId } = job.data;
    return RequestContextStore.run(
      {
        requestId: `mkt-pull-${connectionId}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.runner.run(orgId, connectionId),
    );
  }
}
