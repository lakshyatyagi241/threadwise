import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { FulfilmentService } from './fulfilment.service';
import { GatewayService } from './gateway.service';
import { toDriverOrder } from './payment-confirmation.service';
import { OrdersRepository } from './orders.repository';
import { PaygwStore } from './paygw.store';

/** A buyer is still on the payment page for a few minutes; the webhook and the return normally settle it well inside this. */
export const TOPUP_STALE_AFTER_MINUTES = 10;
/** Past this the provider's own session or order has expired and a late payment is a refund case, not a credit. */
export const TOPUP_GIVE_UP_AFTER_HOURS = 72;
const BATCH = 25;

export type TopupReconcileOutcome =
  'credited' | 'still_pending' | 'skip_no_driver' | 'skip_cannot_tell' | 'already_settled';

/**
 * The safety net for a paid wallet top-up that never got credited (legacy #11798, #11841, #15173). The credit is idempotent and
 * atomic with the order (FulfilmentService), but it only runs when the provider's webhook or the buyer's browser return arrives; lose
 * both (a missed webhook and a closed tab) and the order stays `pending` forever. This sweep asks the provider directly about each
 * old pending top-up and runs the same fulfilment when the provider reports exactly the order's amount as collected. A provider that
 * cannot be asked is left alone; a replay is a no-op because fulfilment owns the paid transition.
 */
@Injectable()
export class TopupReconcilerService {
  private readonly logger = new Logger(TopupReconcilerService.name);

  constructor(
    private readonly store: PaygwStore,
    private readonly gateways: GatewayService,
    private readonly orders: OrdersRepository,
    private readonly fulfilment: FulfilmentService,
  ) {}

  async sweep(): Promise<Record<string, number>> {
    const uuids = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT uuid FROM orders
         WHERE kind = 'wallet_topup' AND status = 'pending' AND gateway_order_id IS NOT NULL
           AND created_at < now() - make_interval(mins => ${TOPUP_STALE_AFTER_MINUTES})
           AND created_at > now() - make_interval(hours => ${TOPUP_GIVE_UP_AFTER_HOURS})
         ORDER BY id LIMIT ${BATCH}`);
      return (res.rows as Array<{ uuid: string }>).map((r) => String(r.uuid));
    });
    const tally: Record<string, number> = {};
    for (const uuid of uuids) {
      try {
        const outcome = await this.reconcileOne(uuid);
        tally[outcome] = (tally[outcome] ?? 0) + 1;
      } catch (err) {
        this.logger.warn({ err, order: uuid }, '[PAYGW] top-up reconcile failed');
        tally.error = (tally.error ?? 0) + 1;
      }
    }
    return tally;
  }

  async reconcileOne(uuid: string): Promise<TopupReconcileOutcome> {
    const order = await this.store.tx((tx) => this.orders.byUuid(tx, uuid));
    if (!order || order.status !== 'pending' || order.kind !== 'wallet_topup')
      return 'already_settled';
    const gateway = order.gatewaySlug ? await this.gateways.bySlug(order.gatewaySlug) : null;
    const driver = gateway ? this.gateways.driverFor(gateway) : null;
    if (!driver?.lookupPayment) return 'skip_no_driver';
    const result = await driver.lookupPayment(toDriverOrder(order)); // no transaction open while the provider answers
    if (result === null) return 'skip_cannot_tell';
    if (result.status !== 'paid') return 'still_pending';
    const { applied } = await this.fulfilment.fulfil(order, {
      gatewayPaymentId: result.gatewayPaymentId,
      payload: result.payload,
    });
    if (applied) this.logger.log({ order: order.orderNumber }, '[PAYGW] top-up credited by sweep');
    return applied ? 'credited' : 'already_settled';
  }
}
