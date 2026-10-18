import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { StorageQuotaPublisher } from '../../../src/modules/storage-quota/storage-quota.publisher';

/**
 * A backfill that failed for good is kept for days under its job id, and BullMQ ignores an `add` whose id still exists: without reviving it
 * the pick-up would queue "nothing" for that workspace for three days and, ordered by id, starve every workspace behind it.
 */
function fakeQueue(state: string) {
  const remove = vi.fn(async () => undefined);
  const queue = {
    getJobState: vi.fn(async () => state),
    getJob: vi.fn(async () => ({ remove })),
    add: vi.fn(async () => undefined),
  };
  return { queue, remove };
}

describe('StorageQuotaPublisher', () => {
  it('removes a failed backfill job before queueing the workspace again', async () => {
    const { queue, remove } = fakeQueue('failed');
    await new StorageQuotaPublisher(queue as unknown as Queue).enqueueBackfill(7);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'storage.backfill',
      { orgId: 7 },
      expect.objectContaining({ jobId: 'storage-backfill-7' }),
    );
  });

  it('leaves a waiting or active backfill job alone (one at a time per workspace)', async () => {
    for (const state of ['waiting', 'active', 'delayed']) {
      const { queue, remove } = fakeQueue(state);
      await new StorageQuotaPublisher(queue as unknown as Queue).enqueueBackfill(7);
      expect(remove, state).not.toHaveBeenCalled();
    }
  });

  it('queues the nightly counter check once per workspace and day, delayed to spread the fan-out', async () => {
    const { queue } = fakeQueue('unknown');
    await new StorageQuotaPublisher(queue as unknown as Queue).enqueueReconcile(
      7,
      '2027-01-06',
      500,
    );
    expect(queue.add).toHaveBeenCalledWith(
      'storage.reconcile',
      { orgId: 7 },
      expect.objectContaining({ jobId: 'storage-reconcile-7-2027-01-06', delay: 500 }),
    );
  });
});
