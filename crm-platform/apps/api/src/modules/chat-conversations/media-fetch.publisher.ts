import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../infra/queue/queues';
import {
  MEDIA_FETCH_JOB,
  MEDIA_FETCH_JOB_OPTIONS,
  mediaFetchJobId,
  type MediaFetchJob,
} from './media-fetch.job';

/** Puts a "copy this customer's file" job on `media-fetch`. Used by ingest (after the message commits), the Retry, and the recovery sweep. */
@Injectable()
export class MediaFetchPublisher {
  constructor(@InjectQueue(QUEUES.MEDIA_FETCH) private readonly queue: Queue) {}

  /** The job id is fixed per message and generation: enqueueing the same one twice is one job. */
  async enqueue(orgId: number, messageUuid: string, generation: number): Promise<void> {
    const job: MediaFetchJob = { orgId, messageUuid, generation };
    await this.queue.add(MEDIA_FETCH_JOB, job, {
      ...MEDIA_FETCH_JOB_OPTIONS,
      jobId: mediaFetchJobId(messageUuid, generation),
    });
  }

  /**
   * The recovery sweep's re-enqueue: a live job is left alone (false); a finished or failed job that still holds the id is removed first,
   * because BullMQ would otherwise drop the new job as a duplicate of its own history.
   */
  async requeue(orgId: number, messageUuid: string, generation: number): Promise<boolean> {
    const existing = await this.queue.getJob(mediaFetchJobId(messageUuid, generation));
    if (existing) {
      const state = await existing.getState();
      if (state !== 'failed' && state !== 'completed') return false;
      await existing.remove();
    }
    await this.enqueue(orgId, messageUuid, generation);
    return true;
  }
}
