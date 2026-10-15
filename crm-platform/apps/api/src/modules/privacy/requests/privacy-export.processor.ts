import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../../common/context/request-context';
import { QUEUES } from '../../../infra/queue/queues';
import { PRIVACY_EXPORT_JOB, privacyExportJobSchema } from './privacy-export.job';
import { PrivacyExportRunner } from './privacy-export.runner';

/** Consumes `privacy-export`. Registered only in the worker process. Concurrency 1: the file of one person is built in memory. */
@Processor(QUEUES.PRIVACY_EXPORT, { concurrency: 1 })
export class PrivacyExportProcessor extends WorkerHost {
  constructor(private readonly runner: PrivacyExportRunner) {
    super();
  }

  async process(job: Job): Promise<string> {
    if (job.name !== PRIVACY_EXPORT_JOB) {
      throw new UnrecoverableError(`Unknown job "${job.name}" on the privacy-export queue`);
    }
    const parsed = privacyExportJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(
        `Malformed privacy-export job: ${parsed.error.issues[0]?.message ?? ''}`,
      );
    }
    const { orgId, exportUuid } = parsed.data;
    return RequestContextStore.run(
      {
        requestId: `privacy-export-${job.id ?? ''}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.runner.run(orgId, exportUuid),
    );
  }
}
