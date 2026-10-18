import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextStore } from '../../common/context/request-context';
import { QUEUES } from '../../infra/queue/queues';
import { StorageBackfillService } from './storage-backfill.service';
import {
  STORAGE_BACKFILL_JOB,
  STORAGE_RECONCILE_JOB,
  storageJobSchema,
} from './storage-quota.job';
import { StorageReconcileService } from './storage-reconcile.service';

/**
 * Consumes `storage-quota`: the backfill and the nightly counter check of one workspace per job. Registered only in the worker process.
 * Concurrency 2: both read a workspace page by page and the backfill may wait on the object store, so more would only compete with live
 * traffic for connections.
 */
@Processor(QUEUES.STORAGE_QUOTA, { concurrency: 2 })
export class StorageQuotaProcessor extends WorkerHost {
  constructor(
    private readonly backfill: StorageBackfillService,
    private readonly reconcile: StorageReconcileService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== STORAGE_BACKFILL_JOB && job.name !== STORAGE_RECONCILE_JOB) {
      throw new UnrecoverableError(`Unknown job "${job.name}" on the storage-quota queue`);
    }
    const parsed = storageJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(
        `Malformed storage-quota job: ${parsed.error.issues[0]?.message ?? ''}`,
      );
    }
    const { orgId } = parsed.data;
    return RequestContextStore.run(
      {
        requestId: `storage-quota-${job.id ?? ''}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        job.name === STORAGE_BACKFILL_JOB
          ? this.backfill.backfillOrg(orgId)
          : this.reconcile.reconcileOrg(orgId),
    );
  }
}
