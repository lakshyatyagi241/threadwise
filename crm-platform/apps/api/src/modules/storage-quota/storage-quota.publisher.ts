import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { addOrRevive } from '../../infra/queue/add-or-revive';
import { QUEUES } from '../../infra/queue/queues';
import {
  STORAGE_BACKFILL_JOB,
  STORAGE_JOB_OPTIONS,
  STORAGE_RECONCILE_JOB,
  storageBackfillJobId,
  storageReconcileJobId,
  type StorageJob,
} from './storage-quota.job';

/** Puts backfill and reconcile jobs on `storage-quota`. Used by the worker's scheduler. */
@Injectable()
export class StorageQuotaPublisher {
  constructor(@InjectQueue(QUEUES.STORAGE_QUOTA) private readonly queue: Queue) {}

  async enqueueBackfill(orgId: number): Promise<void> {
    const job: StorageJob = { orgId };
    // A backfill that failed for good is kept for days under its id and would absorb every later add: revive it (the pick-up retries a
    // workspace until `backfilled_at` is set).
    await addOrRevive(this.queue, STORAGE_BACKFILL_JOB, job, {
      ...STORAGE_JOB_OPTIONS,
      jobId: storageBackfillJobId(orgId),
    });
  }

  /** `delayMs` spreads a fleet-wide fan-out over the night instead of queueing every workspace at once. */
  async enqueueReconcile(orgId: number, day: string, delayMs = 0): Promise<void> {
    const job: StorageJob = { orgId };
    await this.queue.add(STORAGE_RECONCILE_JOB, job, {
      ...STORAGE_JOB_OPTIONS,
      jobId: storageReconcileJobId(orgId, day),
      delay: delayMs,
    });
  }
}
