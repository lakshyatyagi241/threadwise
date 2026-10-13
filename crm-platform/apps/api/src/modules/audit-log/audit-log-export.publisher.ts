import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../infra/queue/queues';
import {
  AUDIT_LOG_EXPORT_JOB,
  AUDIT_LOG_EXPORT_JOB_OPTIONS,
  auditLogExportJobId,
  type AuditLogExportJob,
} from './audit-log-export.job';

/** Puts a "build this export" job on `audit-log-export`, after the export row has committed. */
@Injectable()
export class AuditLogExportPublisher {
  constructor(@InjectQueue(QUEUES.AUDIT_LOG_EXPORT) private readonly queue: Queue) {}

  async enqueue(orgId: number, exportUuid: string): Promise<void> {
    const job: AuditLogExportJob = { orgId, exportUuid };
    await this.queue.add(AUDIT_LOG_EXPORT_JOB, job, {
      ...AUDIT_LOG_EXPORT_JOB_OPTIONS,
      jobId: auditLogExportJobId(exportUuid),
    });
  }
}
