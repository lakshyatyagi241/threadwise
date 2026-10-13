import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { QUEUES } from '../../infra/queue/queues';
import { AUDIT_LOG_EXPORT_JOB, auditLogExportJobSchema } from './audit-log-export.job';
import { AuditLogExportRunner } from './audit-log-export.runner';

/**
 * Consumes `audit-log-export`: one job per requested export of the audit log. Registered only in the worker process. Concurrency 1: a
 * year of audit rows is read page by page and held in memory as it is compressed, so two at once on one worker is the limit of what is
 * kind to the database.
 */
@Processor(QUEUES.AUDIT_LOG_EXPORT, { concurrency: 1 })
export class AuditLogExportProcessor extends WorkerHost {
  constructor(private readonly runner: AuditLogExportRunner) {
    super();
  }

  async process(job: Job): Promise<string> {
    if (job.name !== AUDIT_LOG_EXPORT_JOB) {
      throw new UnrecoverableError(`Unknown job "${job.name}" on the audit-log-export queue`);
    }
    const parsed = auditLogExportJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(
        `Malformed audit-log-export job: ${parsed.error.issues[0]?.message ?? ''}`,
      );
    }
    const { orgId, exportUuid } = parsed.data;
    return RequestContextStore.run(
      {
        requestId: `audit-export-${job.id ?? ''}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.runner.run(orgId, exportUuid),
    );
  }
}
