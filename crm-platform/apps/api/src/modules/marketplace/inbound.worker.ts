import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import type { Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { InboundEventsRepository } from './inbound-events.repository';
import { InboundIntake } from './inbound-intake.service';
import type { InboundJob } from './inbound-job';
import { InboundRunService, type InboundOutcome } from './inbound-run.service';

/** How long a stored delivery is kept (a processed one has no body by then). Matches the connection's delivery log. */
export const INBOUND_RETENTION_DAYS = 30;

/**
 * The safety net under the door's own job: every 20 seconds, the deliveries nobody is working on whose time has come (a job that was never
 * queued because Redis was down, a retry whose back-off has passed, one a dead worker left half done) are queued again. The job id is the
 * delivery, so one that is still queued or running is never queued a second time. Registered only in the worker process
 * (MarketplaceWorkerModule, imported by WorkersModule).
 */
@Injectable()
export class InboundSweepService {
  private readonly logger = new Logger(InboundSweepService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly events: InboundEventsRepository,
    private readonly intake: InboundIntake,
  ) {}

  @Cron('*/20 * * * * *')
  async run(): Promise<number> {
    const due = await this.db.privileged((tx) => this.events.due(tx, 200));
    for (const d of due) await this.intake.kick(d.orgId, d.id);
    if (due.length > 0) this.logger.debug({ queued: due.length }, 'marketplace inbound sweep');
    return due.length;
  }

  /** Hourly: deliveries past their retention go, with whatever body they still hold. */
  @Cron('37 * * * *')
  async trim(): Promise<number> {
    return this.db.privileged((tx) => this.events.trim(tx, INBOUND_RETENTION_DAYS));
  }
}

@Processor(QUEUES.MKT_INBOUND, { concurrency: 6 })
export class InboundProcessor extends WorkerHost {
  constructor(private readonly runner: InboundRunService) {
    super();
  }

  process(job: Job<InboundJob>): Promise<InboundOutcome> {
    const { orgId, eventId } = job.data;
    return RequestContextStore.run(
      {
        requestId: `mkt-inbound-${eventId}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.runner.run(orgId, eventId),
    );
  }
}
