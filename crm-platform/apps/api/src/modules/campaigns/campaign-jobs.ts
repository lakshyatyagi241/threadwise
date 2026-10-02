import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../infra/queue/queues';

export interface CampaignJob {
  orgId: number;
  campaignId: number;
}

/**
 * Queues a run of one campaign. Each call is its own job (the id carries the time) so a resend or a re-armed campaign never
 * collides with a finished run; two runs at once are stopped by the lock inside the sender, not here. Queuing never throws into
 * the caller: when Redis is down the sweeper picks the campaign up from its `running` status a minute later.
 */
@Injectable()
export class CampaignJobs {
  private readonly logger = new Logger(CampaignJobs.name);

  constructor(@InjectQueue(QUEUES.CAMPAIGN) private readonly queue: Queue<CampaignJob>) {}

  async enqueue(orgId: number, campaignId: number, uuid: string, delayMs = 0): Promise<boolean> {
    try {
      await this.queue.add(
        'run',
        { orgId, campaignId },
        {
          jobId: `${uuid}-${Date.now()}`,
          delay: Math.max(0, delayMs),
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
      return true;
    } catch (err) {
      this.logger.error({ orgId, campaignId, err }, 'could not queue a campaign run');
      return false;
    }
  }
}
