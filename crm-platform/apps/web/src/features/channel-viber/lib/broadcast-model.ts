import type { VibBroadcast } from '@crm/contracts';

/** What the broadcasts list shows for each row (TW-VIB-011, 014). Pure. */

export type RowAction = 'start' | 'pause' | 'retry';

/**
 * The button of a row: a draft starts; a sending one pauses (a worker sends it, so there is no "Resume" for a closed tab as in
 * Reference); a finished or failed one with failed users can be retried.
 */
export function rowAction(b: Pick<VibBroadcast, 'status' | 'failed'>): RowAction | null {
  if (b.status === 'draft') return 'start';
  if (b.status === 'sending') return 'pause';
  return b.failed > 0 ? 'retry' : null;
}

/** The receipts line under the progress bar, empty until Viber has reported something. */
export const hasReceipts = (b: Pick<VibBroadcast, 'delivered' | 'seen'>): boolean =>
  b.delivered > 0 || b.seen > 0;
