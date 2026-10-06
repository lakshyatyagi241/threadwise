import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { QUEUES } from '../../infra/queue/queues';
import { CampaignDispatchService } from './campaign-dispatch.service';
import type { CampaignJob } from './campaign-jobs';
import { FIXTURE_RECEIPT_JOB, FixtureReceiptConsumer } from './fixture/fixture-receipts';
import type { FixtureReceipt } from './fixture/fixture-engine-sender';

const BUSY_RETRY_MS = 15_000;

/**
 * Runs one campaign per job (WD-CAMP-011). Registered only in the worker process (CampaignsWorkerModule, imported by
 * WorkersModule): the HTTP app queues runs but never picks one up.
 */
@Processor(QUEUES.CAMPAIGN, { concurrency: 4 })
export class CampaignProcessor extends WorkerHost {
  private readonly logger = new Logger(CampaignProcessor.name);

  constructor(
    private readonly dispatch: CampaignDispatchService,
    private readonly fixtureReceipts: FixtureReceiptConsumer,
  ) {
    super();
  }

  async process(job: Job<CampaignJob | FixtureReceipt>, token?: string): Promise<string> {
    // The sandbox's own delivery reports (CAMP_PROVIDER_MODE=fixture) travel on this queue; they are what a webhook would have been.
    if (job.name === FIXTURE_RECEIPT_JOB) {
      return (await this.fixtureReceipts.deliver(job.data as FixtureReceipt))
        ? 'applied'
        : 'unowned';
    }
    const { orgId, campaignId } = job.data as CampaignJob;
    return RequestContextStore.run(
      {
        requestId: `camp-${campaignId}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      async () => {
        try {
          const result = await this.dispatch.run(orgId, campaignId);
          if (result === 'busy') {
            // The campaign or its number is in use by another run: wait and try again, without using up a retry.
            await job.moveToDelayed(Date.now() + BUSY_RETRY_MS, token);
            throw new DelayedError();
          }
          return result;
        } catch (err) {
          if (err instanceof DelayedError) throw err;
          // A rule the data broke will break again: do not retry it. Anything else (database, network) retries with backoff.
          if (err instanceof AppError) throw new UnrecoverableError(err.message);
          this.logger.error({ orgId, campaignId, err }, '[CAMP] run job crashed');
          throw err;
        }
      },
    );
  }
}
