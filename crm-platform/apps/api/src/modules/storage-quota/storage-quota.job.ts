import { z } from 'zod';

/**
 * Jobs on `storage-quota`: one per workspace, carrying the id only (the worker re-reads everything). Both are idempotent, so a retry or
 * a duplicate does the same work again and changes nothing.
 */
export const STORAGE_BACKFILL_JOB = 'storage.backfill';
export const STORAGE_RECONCILE_JOB = 'storage.reconcile';

export const storageJobSchema = z.object({ orgId: z.number().int().positive() });
export type StorageJob = z.infer<typeof storageJobSchema>;

/** A failed attempt is retried a few times with the queue's backoff; the nightly fan-out and the 10-minute pickup are the real safety nets. */
export const STORAGE_JOB_OPTIONS = { attempts: 3 };

/** `:` is reserved by BullMQ. */
export const storageBackfillJobId = (orgId: number): string => `storage-backfill-${orgId}`;
export const storageReconcileJobId = (orgId: number, day: string): string =>
  `storage-reconcile-${orgId}-${day}`;
