import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../infra/queue/queues';
import type { JobEnqueuer } from './waboo-migration.engine';

/** A job carries only a uuid; everything else is re-read from the rows. */
export interface MigrateJob {
  runUuid?: string;
  batchUuid?: string;
}

export const jobId = (kind: 'migrate' | 'batch', uuid: string): string =>
  kind === 'batch' ? `wmig-batch-${uuid}` : `wmig-${uuid}`;

/** The BullMQ side of the panel. One attempt only: a migration must never be repeated by a retry. */
@Injectable()
export class WabooMigrationJobs implements JobEnqueuer {
  constructor(@InjectQueue(QUEUES.WAB_MIGRATE) private readonly queue: Queue<MigrateJob>) {}

  /** Adds the job (delayed for a scheduled item). A job with the same id that is still waiting, delayed or active is left alone. */
  async ensure(kind: 'migrate' | 'batch', uuid: string, delayMs: number): Promise<boolean> {
    const id = jobId(kind, uuid);
    const existing = await this.queue.getJob(id);
    if (existing) {
      const state = await existing.getState();
      // A finished job keeps its id and would swallow the add; the row is still queued, so the job must run again.
      if (state !== 'completed' && state !== 'failed') return false;
      await existing.remove().catch(() => undefined);
    }
    await this.queue.add(kind, kind === 'batch' ? { batchUuid: uuid } : { runUuid: uuid }, {
      jobId: id,
      attempts: 1,
      delay: delayMs,
    });
    return true;
  }

  /** Best effort: drops a job that has not started. The worker also skips rows that are no longer queued. */
  async remove(kind: 'migrate' | 'batch', uuid: string): Promise<void> {
    await this.queue.remove(jobId(kind, uuid)).catch(() => undefined);
  }
}
