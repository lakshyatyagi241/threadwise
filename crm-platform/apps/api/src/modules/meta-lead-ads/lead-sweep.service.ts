import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { META_LEAD_SWEEP_JOB, type MetaLeadSweepJob } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { MetaLeadAdsRepository } from './meta-lead-ads.repository';

/**
 * Every ten minutes, one sweep job per Page that has lead sync on and a form picked, across all workspaces (spec L-06: a missed webhook
 * never loses a lead). Registered only in the worker process. The job id is the Page, and a finished job is removed at once, so a sweep
 * that is still waiting or running is never doubled (several worker replicas all ticking enqueue one job) and the next tick is not
 * blocked by the last one.
 */
@Injectable()
export class LeadSweepService {
  private readonly logger = new Logger(LeadSweepService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MetaLeadAdsRepository,
    @InjectQueue(QUEUES.META_LEAD_SWEEP) private readonly queue: Queue<MetaLeadSweepJob>,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run(): Promise<number> {
    const pages = await this.db.privileged((tx) => this.repo.pagesToSweep(tx));
    let queued = 0;
    for (const p of pages) {
      try {
        await this.queue.add(META_LEAD_SWEEP_JOB, p, {
          jobId: `sweep-${p.orgId}-${p.pageId}`,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        });
        queued += 1;
      } catch (err) {
        this.logger.error({ err, orgId: p.orgId, page: p.pageId }, 'lead sweep not queued');
      }
    }
    return queued;
  }
}
