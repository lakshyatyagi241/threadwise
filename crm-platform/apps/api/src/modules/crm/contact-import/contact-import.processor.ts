import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { QUEUES } from '../../../infra/queue/queues';
import { ContactImportEngine } from './contact-import.engine';

export interface ContactImportJobData {
  orgId: number;
  userId: number | null;
  /** contact_import_jobs.id: the job carries ids, the engine re-reads everything it needs. */
  jobId: number;
}

/**
 * Runs queued contact imports (TW-CON-027). Registered only in the worker process
 * (ContactImportWorkerModule, imported by WorkersModule), never in the HTTP app.
 *
 * Safe to run twice: the engine resumes from the rows the job row says are done, and a number
 * already imported is matched, not duplicated.
 */
@Processor(QUEUES.CON_IMPORT, { concurrency: 2 })
export class ContactImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ContactImportProcessor.name);

  constructor(private readonly engine: ContactImportEngine) {
    super();
  }

  async process(job: Job<ContactImportJobData>): Promise<void> {
    const { orgId, userId, jobId } = job.data;
    // A worker has no HTTP request: the context is built from the job payload so the audit and
    // outbox rows the engine writes carry the right tenant and the person who started the import.
    await RequestContextStore.run(
      {
        requestId: `con-import-${jobId}`,
        orgId,
        actorType: 'user',
        actorId: userId,
        userId,
      },
      async () => {
        try {
          await this.engine.run(orgId, userId, jobId);
        } catch (err) {
          // A rule the data broke (plan limit, a missing group) will break again: do not retry it.
          if (err instanceof AppError) throw new UnrecoverableError(err.message);
          throw err;
        }
      },
    );
    this.logger.log({ orgId, jobId }, 'contact import finished');
  }
}
