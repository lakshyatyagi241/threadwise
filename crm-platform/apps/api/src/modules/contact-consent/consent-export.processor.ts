import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { QUEUES } from '../../infra/queue/queues';
import { CONSENT_EXPORT_JOB, consentExportJobSchema } from './consent-export.job';
import { ConsentExportRunner } from './consent-export.runner';

/**
 * Consumes `consent-export`: one job per requested export of the consent proof. Registered only in the worker process. Concurrency 1: a
 * large ledger is read page by page and held in memory as it is compressed, so two at once on one worker is the limit of what is kind to
 * the database.
 */
@Processor(QUEUES.CONSENT_EXPORT, { concurrency: 1 })
export class ConsentExportProcessor extends WorkerHost {
  constructor(private readonly runner: ConsentExportRunner) {
    super();
  }

  async process(job: Job): Promise<string> {
    if (job.name !== CONSENT_EXPORT_JOB) {
      throw new UnrecoverableError(`Unknown job "${job.name}" on the consent-export queue`);
    }
    const parsed = consentExportJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(
        `Malformed consent-export job: ${parsed.error.issues[0]?.message ?? ''}`,
      );
    }
    const { orgId, exportUuid } = parsed.data;
    return RequestContextStore.run(
      {
        requestId: `consent-export-${job.id ?? ''}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.runner.run(orgId, exportUuid),
    );
  }
}
