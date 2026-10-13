import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../infra/queue/queues';
import {
  MESSAGE_LOG_EXPORT_JOB,
  MESSAGE_LOG_EXPORT_JOB_OPTIONS,
  messageLogExportJobId,
  type MessageLogExportJob,
} from './message-log-export.job';

/** Puts a "build this export" job on `msg-log-export`, after the export row has committed. */
@Injectable()
export class MessageLogExportPublisher {
  constructor(@InjectQueue(QUEUES.MSG_LOG_EXPORT) private readonly queue: Queue) {}

  async enqueue(orgId: number, exportUuid: string): Promise<void> {
    const job: MessageLogExportJob = { orgId, exportUuid };
    await this.queue.add(MESSAGE_LOG_EXPORT_JOB, job, {
      ...MESSAGE_LOG_EXPORT_JOB_OPTIONS,
      jobId: messageLogExportJobId(exportUuid),
    });
  }
}
