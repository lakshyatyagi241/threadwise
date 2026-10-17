import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { QUEUES } from '../../infra/queue/queues';
import { IG_HELD_JOB, BroadcastsService, type IgHeldJob } from './broadcasts.service';
import { PullService, type PullJob, type PullResult } from './pull.service';

/**
 * Pulls one organization's new Instagram messages (TW-IG-009). Registered only in the worker process
 * (ChannelInstagramWorkerModule, imported by WorkersModule): the HTTP app never runs it. A retry is safe because every message is
 * stored once by the engine's id.
 */
@Processor(QUEUES.IG_PULL, { concurrency: 4 })
export class IgPullProcessor extends WorkerHost {
  private readonly logger = new Logger(IgPullProcessor.name);

  constructor(
    private readonly pull: PullService,
    private readonly broadcasts: BroadcastsService,
  ) {
    super();
  }

  process(
    job: Job<PullJob | IgHeldJob>,
  ): Promise<PullResult | { sent: number; failed: number; held: number }> {
    // The send the quiet hours held back (BL-191) travels on this queue too: it is a delayed job for the first opening.
    if (job.name === IG_HELD_JOB) {
      const held = job.data as IgHeldJob;
      return RequestContextStore.run(
        {
          requestId: `ig-held-${held.orgId}`,
          orgId: held.orgId,
          actorType: 'system',
          actorId: null,
          userId: held.userId,
        },
        () => this.broadcasts.releaseHeld(held),
      );
    }
    const { orgId, force } = job.data as PullJob;
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
