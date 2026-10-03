import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { AccountsRepository } from './accounts.repository';
import { PullService, type PullJob } from './pull.service';

/**
 * Every 20 seconds, one pull job for each organization that has a linked Instagram account (WD-IG-009). WaDesk pulled while the
 * inbox was being polled (at most every 12 seconds per workspace); with no page poll to hang it on, a worker does it. The job id is
 * the organization, so a pull still running or waiting is never queued a second time. Registered only in the worker process.
 */
@Injectable()
export class PullSweepService {
  private readonly logger = new Logger(PullSweepService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly accounts: AccountsRepository,
    private readonly pull: PullService,
    @InjectQueue(QUEUES.IG_PULL) private readonly queue: Queue<PullJob>,
  ) {}

  @Cron('*/20 * * * * *')
  async run(): Promise<number> {
    // No engine, nothing to ask: the organizations are not even listed.
    if (!(await this.pull.configured())) return 0;
    const orgs = await this.db.privileged((tx) => this.accounts.orgsWithAccounts(tx));
    let queued = 0;
    for (const orgId of orgs) {
      try {
        await this.queue.add(
          'pull',
          { orgId },
          { jobId: `ig-pull-${orgId}`, attempts: 1, removeOnComplete: true, removeOnFail: true },
        );
        queued += 1;
      } catch (err) {
        this.logger.error({ err, orgId }, 'instagram pull not queued');
      }
    }
    return queued;
  }
}
