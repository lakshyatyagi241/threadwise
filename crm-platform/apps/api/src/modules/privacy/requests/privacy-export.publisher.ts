import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../../infra/queue/queues';
import {
  PRIVACY_EXPORT_JOB,
  PRIVACY_EXPORT_JOB_OPTIONS,
  privacyExportJobId,
  type PrivacyExportJob,
} from './privacy-export.job';

/** Puts a "build this export" job on `privacy-export`, after the export row has committed. */
@Injectable()
export class PrivacyExportPublisher {
  constructor(@InjectQueue(QUEUES.PRIVACY_EXPORT) private readonly queue: Queue) {}

  async enqueue(orgId: number, exportUuid: string): Promise<void> {
    const job: PrivacyExportJob = { orgId, exportUuid };
    await this.queue.add(PRIVACY_EXPORT_JOB, job, {
      ...PRIVACY_EXPORT_JOB_OPTIONS,
      jobId: privacyExportJobId(exportUuid),
    });
  }
}
