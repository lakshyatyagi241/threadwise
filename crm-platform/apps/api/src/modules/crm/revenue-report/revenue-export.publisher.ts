import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../../infra/queue/queues';
import {
  REVENUE_EXPORT_JOB,
  REVENUE_EXPORT_JOB_OPTIONS,
  revenueExportJobId,
  type RevenueExportJob,
} from './revenue-export.job';

/** Puts a "build this file" job on `revenue-report-export`, after the export row has committed. */
@Injectable()
export class RevenueExportPublisher {
  constructor(@InjectQueue(QUEUES.REVENUE_EXPORT) private readonly queue: Queue) {}

  async enqueue(orgId: number, exportUuid: string): Promise<void> {
    const job: RevenueExportJob = { orgId, exportUuid };
    await this.queue.add(REVENUE_EXPORT_JOB, job, {
      ...REVENUE_EXPORT_JOB_OPTIONS,
      jobId: revenueExportJobId(exportUuid),
    });
  }
}
