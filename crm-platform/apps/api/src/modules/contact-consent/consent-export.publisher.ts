import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../infra/queue/queues';
import {
  CONSENT_EXPORT_JOB,
  CONSENT_EXPORT_JOB_OPTIONS,
  consentExportJobId,
  type ConsentExportJob,
} from './consent-export.job';

/** Puts a "build this export" job on `consent-export`, after the export row has committed. */
@Injectable()
export class ConsentExportPublisher {
  constructor(@InjectQueue(QUEUES.CONSENT_EXPORT) private readonly queue: Queue) {}

  async enqueue(orgId: number, exportUuid: string): Promise<void> {
    const job: ConsentExportJob = { orgId, exportUuid };
    await this.queue.add(CONSENT_EXPORT_JOB, job, {
      ...CONSENT_EXPORT_JOB_OPTIONS,
      jobId: consentExportJobId(exportUuid),
    });
  }
}
