import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../../common/context/request-context';
import { QUEUES } from '../../../infra/queue/queues';
import { REVENUE_EXPORT_JOB, revenueExportJobSchema } from './revenue-export.job';
import { RevenueExportRunner } from './revenue-export.runner';

/**
 * Consumes `revenue-report-export`: one job per requested file of the revenue report. Registered only in the worker process.
 * Concurrency 1: a ledger CSV of a busy year is read page by page and held in memory as it is compressed, so two at once on one
 * worker is the limit of what is kind to the database.
 */
@Processor(QUEUES.REVENUE_EXPORT, { concurrency: 1 })
export class RevenueExportProcessor extends WorkerHost {
  constructor(private readonly runner: RevenueExportRunner) {
    super();
  }

  async process(job: Job): Promise<string> {
    if (job.name !== REVENUE_EXPORT_JOB) {
      throw new UnrecoverableError(`Unknown job "${job.name}" on the revenue-report-export queue`);
    }
    const parsed = revenueExportJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(
        `Malformed revenue-report-export job: ${parsed.error.issues[0]?.message ?? ''}`,
      );
    }
    const { orgId, exportUuid } = parsed.data;
    return RequestContextStore.run(
      {
        requestId: `revenue-export-${job.id ?? ''}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.runner.run(orgId, exportUuid),
    );
  }
}
