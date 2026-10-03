import { Injectable, Logger } from '@nestjs/common';
import {
  CANCELLED_BY_USER,
  type DriverOrder,
  type PaymentResult,
} from '../../infra/providers/platform-payment-gateways';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { FulfilmentService } from './fulfilment.service';
import { GatewayService } from './gateway.service';
import { MANUAL_GATEWAYS } from './gateway-rules';
import { recordOrderEvent } from './order-events';
import { majorToMinor, minorToMajor } from './order-pricing';
import { OrdersRepository, type OrderRow } from './orders.repository';
import { PaygwStore } from './paygw.store';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

export type ConfirmOutcome = 'success' | 'failed' | 'cancelled' | 'pending';

/** The order as a driver sees it: nothing but what it needs to charge, confirm and describe. */
export function toDriverOrder(o: OrderRow, planName?: string): DriverOrder {
  const minor = majorToMinor(o.totalAmount, o.currency) ?? 0n;
  return {
    orderNumber: o.orderNumber,
    amountMinor: minor,
    amountMajor: minorToMajor(minor, o.currency),
    currency: o.currency,
    description: o.kind === 'wallet_topup' ? 'Wallet top-up' : (planName ?? o.planSlug ?? 'Plan'),
    planName,
    customerName: o.customerName,
    customerEmail: o.customerEmail,
    gatewayOrderId: o.gatewayOrderId,
  };
}

/**
 * ONE way a provider result becomes an order outcome (WD-PAYGW-034 port note), used by the buyer's browser return and by an
 * in-app client confirming its own order. A paid result runs the fulfilment (whose conditional update makes a repeat harmless)
 * and activates the subscription when the order was a recurring checkout; a decline marks the order failed or cancelled, never
 * over a paid one; an undecided provider leaves it pending.
 */
@Injectable()
export class PaymentConfirmationService {
  private readonly logger = new Logger(PaymentConfirmationService.name);

  constructor(
    private readonly store: PaygwStore,
    private readonly gateways: GatewayService,
    private readonly orders: OrdersRepository,
    private readonly fulfilment: FulfilmentService,
    private readonly subscriptions: SubscriptionLifecycleService,
    private readonly outbox: OutboxService,
  ) {}

  async confirm(
    order: OrderRow,
    params: Record<string, string>,
  ): Promise<{ outcome: ConfirmOutcome; alreadyPaid: boolean }> {
    // Already paid (a reloaded return page, or the webhook got there first): a success, never re-confirmed and never
    // overwritten by a later failing payload.
    if (order.status === 'paid') return { outcome: 'success', alreadyPaid: true };
    const slug = order.gatewaySlug;
    if (!slug || MANUAL_GATEWAYS.includes(slug)) return { outcome: 'pending', alreadyPaid: false };
    const gateway = await this.gateways.bySlug(slug);
    if (!gateway) return { outcome: 'failed', alreadyPaid: false };

    let result: PaymentResult;
    try {
      result = await this.gateways.driverFor(gateway).confirmReturn(params, toDriverOrder(order));
    } catch (e) {
      result = {
        status: 'failed',
        error: `callback_exception: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200),
      };
    }

    if (result.status === 'paid') {
      await this.fulfilment.fulfil(order, {
        gatewayPaymentId: result.gatewayPaymentId,
        payload: result.payload,
      });
      try {
        await this.subscriptions.activateForOrder(order, slug, result.payload);
      } catch (err) {
        // The payment is real and applied; a failed activation is logged and the provider's notification repairs it.
        this.logger.error({ err, order: order.orderNumber }, 'subscription activation failed');
      }
      return { outcome: 'success', alreadyPaid: false };
    }
    if (result.status === 'pending') {
      // WaDesk marked these failed; the buyer may have paid and the provider simply not have settled yet.
      return { outcome: 'pending', alreadyPaid: false };
    }
    const cancelled = result.error === CANCELLED_BY_USER;
    await this.store.tx(async (tx) => {
      const changed = await this.orders.markUnpaid(
        tx,
        order.orgId,
        order.id,
        cancelled ? 'cancelled' : 'failed',
        result.error ?? null,
        result.payload,
      );
      if (changed) {
        await recordOrderEvent(tx, this.outbox, order, cancelled ? 'cancelled' : 'failed', {
          reason: result.error ?? null,
        });
      }
    });
    return { outcome: cancelled ? 'cancelled' : 'failed', alreadyPaid: false };
  }
}
