import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RequestContextStore } from '../../../common/context/request-context';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import {
  GatewayPaymentRegistry,
  type GatewayPaymentContext,
  type GatewayPaymentOutcome,
  type GatewayPaymentSettler,
} from '../../checkout-orders-merchant-payments';
import { ORDERS_GATEWAY, type OrdersGateway } from '../_shims/tokens';
import {
  ORDER_REFERENCE_PREFIX,
  orderNoFromReference,
  paymentMatchesOrder,
} from '../rules/order-reference';

/**
 * Settles a store order from a verified notification of a shared workspace gateway (any driver other than Razorpay's payment
 * links, which keep their own webhook). The gateway module verified the signature with the gateway's own secret and routed the
 * reference here by its `WAORD-` prefix.
 *
 * Same guards as the Razorpay webhook (decision D-04): the order must be one this gateway may settle (a shop's own gateway only
 * its shop's orders; the workspace gateway any order of the workspace), a replay changes nothing, a cancelled order is not revived,
 * and what the provider says it collected must equal the order.
 */
@Injectable()
export class OrderPaymentSettler implements GatewayPaymentSettler, OnModuleInit {
  readonly prefix = ORDER_REFERENCE_PREFIX;
  private readonly logger = new Logger(OrderPaymentSettler.name);

  constructor(
    private readonly registry: GatewayPaymentRegistry,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(ORDERS_GATEWAY) private readonly orders: OrdersGateway,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async settle(ctx: GatewayPaymentContext): Promise<GatewayPaymentOutcome> {
    const orderNo = orderNoFromReference(ctx.reference);
    if (orderNo === null) return { outcome: 'rejected:bad_reference' };
    const order = await this.orders.findForPayment(ctx.tx, ctx.orgId, orderNo);
    if (!order) return { outcome: 'rejected:order_unknown' };
    if (ctx.gateway.storefrontId !== 0 && order.storefrontId !== ctx.gateway.storefrontId) {
      this.logger.warn(
        `[STORE-PAY] order ${orderNo} is not in the shop of gateway ${ctx.gateway.id}`,
      );
      return { outcome: 'rejected:order_not_in_shop' };
    }
    if (order.status === 'paid') return { outcome: 'duplicate' };
    if (order.status === 'cancelled') return { outcome: 'rejected:order_cancelled' };
    if (!paymentMatchesOrder(order, ctx.payment)) {
      this.logger.warn(`[STORE-PAY] amount/currency mismatch on order ${orderNo}`);
      return { outcome: 'rejected:amount_mismatch' };
    }

    await this.orders.markPaid(ctx.tx, ctx.orgId, order.id, {
      paymentLink: null,
      meta: {
        paid_via: ctx.gateway.slug,
        gateway_slug: ctx.gateway.slug,
        gateway_payment_id: ctx.payment.gatewayPaymentId ?? null,
        gateway_order_id: ctx.payment.gatewayOrderId ?? null,
      },
    });

    // The machine is the actor: the audit row says so, in this organization.
    const base = RequestContextStore.require();
    await RequestContextStore.run(
      { ...base, orgId: ctx.orgId, actorType: 'system', actorId: null, userId: null },
      () =>
        this.audit.record(ctx.tx, {
          module: 'wa_orders',
          recordId: order.id,
          action: 'update',
          delta: { status: { old: order.status, new: 'paid' } },
        }),
    );
    await this.outbox.emit(ctx.tx, {
      orgId: ctx.orgId,
      aggregateModule: 'wa_orders',
      aggregateId: order.id,
      eventType: 'store.order_paid',
      payload: {
        orderNo: order.id,
        orderId: order.uuid,
        totalMinor: order.totalMinor,
        currencyCode: order.currencyCode,
        via: ctx.gateway.slug,
      },
    });
    return { outcome: 'applied' };
  }
}
