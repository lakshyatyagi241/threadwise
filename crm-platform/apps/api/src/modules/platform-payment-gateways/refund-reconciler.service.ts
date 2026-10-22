import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ProviderRefund } from '../../infra/providers/platform-payment-gateways/payment-driver';
import { GatewayService } from './gateway.service';
import { PaygwStore } from './paygw.store';
import { RefundService } from './refund.service';

/** A refund is claimed `pending` before the provider is asked; one that old has had time to be answered by the request that made it. */
export const STALE_AFTER_MINUTES = 15;
/** After this long with no trace at the provider, the request never reached it. */
export const GIVE_UP_AFTER_HOURS = 2;
const BATCH = 25;
/** The provider lists this many refunds per call; a full page may hide ours on the next one. */
export const PROVIDER_PAGE = 100;

type Raw = Record<string, unknown>;

export type RefundReconcileOutcome =
  | 'recorded'
  | 'failed_not_found'
  | 'waiting'
  | 'skip_no_driver'
  | 'skip_cannot_tell'
  | 'already_settled';

interface PendingRefund {
  orgId: number;
  id: number;
  uuid: string;
  gateway: string;
  paymentId: string;
  amount: bigint;
  currency: string;
  createdAt: Date;
}

/**
 * Which refund of the provider is this row's? Ours carry the row uuid in their notes (every refund made since the reference was
 * added); an older one is matched on the amount and on being made after the row was. Never one already recorded on another row.
 */
export function matchProviderRefund(
  row: Pick<PendingRefund, 'uuid' | 'amount' | 'createdAt'>,
  list: ProviderRefund[],
  taken: ReadonlySet<string>,
): ProviderRefund | null {
  const free = list.filter((r) => !taken.has(r.id));
  return (
    free.find((r) => r.reference === row.uuid) ??
    free.find(
      (r) =>
        r.reference === null &&
        r.amountMinor === row.amount &&
        r.createdAt.getTime() >= row.createdAt.getTime() - 60_000,
    ) ??
    null
  );
}

/**
 * The safety net for a refund whose answer never got recorded. RefundService writes the attempt as `pending`, asks the provider with no
 * transaction open, then records the answer; a crash between the last two leaves a `pending` row that counts against what the payment
 * held (so the operator cannot retry) and nothing ever settles it. This sweep asks the provider what it holds for the payment: a
 * refund that matches is recorded, and one with no trace after two hours is marked failed (the provider never got it), which frees
 * the amount. A provider that cannot be asked is left alone.
 */
@Injectable()
export class RefundReconcilerService {
  private readonly logger = new Logger(RefundReconcilerService.name);

  constructor(
    private readonly store: PaygwStore,
    private readonly gateways: GatewayService,
    private readonly refunds: RefundService,
  ) {}

  async sweep(): Promise<Record<string, number>> {
    const stale = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT org_id, id, uuid, gateway, gateway_payment_id, amount_minor::text AS amount_minor, currency, created_at
          FROM order_refunds
         WHERE status = 'pending' AND gateway_refund_id IS NULL
           AND created_at < now() - make_interval(mins => ${STALE_AFTER_MINUTES})
         ORDER BY id LIMIT ${BATCH}`);
      return (res.rows as Raw[]).map((r): PendingRefund => ({
        orgId: Number(r.org_id),
        id: Number(r.id),
        uuid: String(r.uuid),
        gateway: String(r.gateway),
        paymentId: String(r.gateway_payment_id),
        amount: BigInt(String(r.amount_minor)),
        currency: String(r.currency),
        createdAt: new Date(String(r.created_at)),
      }));
    });
    const tally: Record<string, number> = {};
    for (const row of stale) {
      try {
        const outcome = await this.reconcileOne(row);
        tally[outcome] = (tally[outcome] ?? 0) + 1;
      } catch (err) {
        this.logger.warn({ err, refund: row.uuid }, '[PAYGW] refund reconcile failed');
        tally.error = (tally.error ?? 0) + 1;
      }
    }
    return tally;
  }

  async reconcileOne(row: PendingRefund): Promise<RefundReconcileOutcome> {
    const gatewayRow = await this.gateways.bySlug(row.gateway);
    const driver = gatewayRow ? this.gateways.driverFor(gatewayRow) : null;
    if (!driver?.listPaymentRefunds) return 'skip_no_driver';
    const list = await driver.listPaymentRefunds(row.paymentId); // no transaction open while the provider answers
    if (list === null) return 'skip_cannot_tell';

    return this.store.tx(async (tx) => {
      // The request that made the refund may have finished meanwhile; settle only a row that is still waiting.
      const locked = await tx.execute(sql`
        SELECT status, gateway_refund_id FROM order_refunds WHERE org_id = ${row.orgId} AND id = ${row.id} FOR UPDATE`);
      const cur = (locked.rows as Raw[])[0];
      if (!cur || cur.status !== 'pending' || cur.gateway_refund_id !== null)
        return 'already_settled';

      const takenRes = await tx.execute(sql`
        SELECT gateway_refund_id FROM order_refunds WHERE gateway_payment_id = ${row.paymentId} AND gateway_refund_id IS NOT NULL`);
      const taken = new Set((takenRes.rows as Raw[]).map((r) => String(r.gateway_refund_id)));
      const found = matchProviderRefund(row, list, taken);
      if (found) {
        await this.refunds.settle(
          tx,
          row,
          { ok: true, refundId: found.id, status: found.status },
          { type: 'system', id: null },
        );
        return 'recorded';
      }
      const ageHours = (Date.now() - row.createdAt.getTime()) / 3_600_000;
      if (ageHours < GIVE_UP_AFTER_HOURS) return 'waiting';
      // Not on a full page is not proof the provider never got it, and failing the row frees the amount for a second refund.
      if (list.length >= PROVIDER_PAGE) return 'skip_cannot_tell';
      await this.refunds.settle(
        tx,
        row,
        { ok: false, reason: 'No refund was found at the provider; the request never reached it.' },
        { type: 'system', id: null },
      );
      return 'failed_not_found';
    });
  }
}
