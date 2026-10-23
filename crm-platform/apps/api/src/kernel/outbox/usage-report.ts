import {
  USAGE_REPORTED_EVENT,
  walletUsageReportedSchema,
  type WalletUsageReported,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import type { OutboxService } from './outbox.service';

/**
 * Reports one usage that costs the customer's wallet money (an SMS, an email, a call, an AI call, a translation, a contact lookup),
 * in the caller's transaction, so the work and its bill commit or roll back together. The worker's billing consumer prices it, takes the
 * money and writes the customer's expense row; it is idempotent on `<kind>:<usageId>`, so reporting the same usage twice charges once.
 *
 * Call it ONCE per real usage, after the work was accepted by the provider (an SMS the carrier took, a call that ended). A report
 * with `status: 'failed'` gives a bill back. Never call it for an inbound message or for the platform's own sends. A report that does
 * not parse is dropped and the function returns false: a bad label must never fail the work it describes.
 *
 * `aggregateId` is the id of the thing the usage belongs to (the broadcast, the call row, the conversation): events of one aggregate are
 * drained in order, events of different ones in parallel.
 */
export async function emitUsageReported(
  outbox: OutboxService,
  tx: Tx,
  o: {
    orgId: number;
    aggregateModule: string;
    aggregateId: number;
    report: Omit<WalletUsageReported, 'status' | 'units'> &
      Partial<Pick<WalletUsageReported, 'status' | 'units'>>;
  },
): Promise<boolean> {
  const parsed = walletUsageReportedSchema.safeParse(o.report);
  if (!parsed.success) return false;
  await outbox.emit(tx, {
    orgId: o.orgId,
    aggregateModule: o.aggregateModule,
    aggregateId: o.aggregateId,
    eventType: USAGE_REPORTED_EVENT,
    payload: parsed.data,
  });
  return true;
}
