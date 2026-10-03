import { z } from 'zod';

/**
 * Sync now (TW-ECOM-013): the store is read again, its facts refreshed, and its products, orders and customers imported again
 * (the import itself runs in the background). A store that does not answer is a result with `ok = false` and the reason, not an
 * HTTP error, so the screen shows it inline.
 */

export const storeCountsSchema = z.object({
  products: z.number().int().min(0),
  orders: z.number().int().min(0),
  customers: z.number().int().min(0),
});
export type StoreCountsView = z.infer<typeof storeCountsSchema>;

export const syncResultSchema = z.object({
  ok: z.boolean(),
  /** Why it failed, when it did. */
  message: z.string().optional(),
  /** The store's own totals. */
  counts: storeCountsSchema.optional(),
  /** The import was queued: its results show on the store's sync times and counts as it finishes. */
  importQueued: z.boolean().optional(),
});
export type SyncResult = z.infer<typeof syncResultSchema>;
