import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type RefundRequest,
  type RefundResponse,
  type SubscriptionRefundRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { AuthAuditService } from '../auth';
import { GatewayService } from './gateway.service';
import { PaygwStore } from './paygw.store';
import { majorToMinor } from './order-pricing';
import { SubscriptionCancelService } from './subscription-cancel.service';

interface Target {
  orgId: number;
  orderId: number | null;
  subscriptionId: number | null;
  gateway: string;
  paymentId: string;
  /** What the payment held, in minor units. */
  paidMinor: bigint;
  currency: string;
}

type Raw = Record<string, unknown>;

const refused = (message: string, why: string): AppError =>
  new AppError(ERROR_CODES.PAYGW_REFUND_REFUSED, message, HttpStatus.UNPROCESSABLE_ENTITY, [
    { path: 'refund', message: why },
  ]);

/**
 * Returns money through the payment provider (an operator action). The attempt is written first as `pending` and counted against what
 * the payment held, THEN the provider is asked with no transaction open, THEN the row takes the provider's answer: a double click or a
 * retry cannot refund more than was paid, and a provider failure leaves a visible `failed` row instead of a lost request.
 *
 * Two doors: a one-time ORDER (the payment id the gateway gave when it was paid) and one CHARGE of a SUBSCRIPTION (the provider's payment
 * id, checked against the subscription's own paid charges, because a renewal has no order and an operator must never refund a payment
 * that is not this subscription's). A refund returns money; it does not take the plan away (the operator decides that), except that the
 * subscription door can also end the subscription so the refunded plan is not charged again.
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly store: PaygwStore,
    private readonly gateways: GatewayService,
    private readonly cancel: SubscriptionCancelService,
    private readonly outbox: OutboxService,
    private readonly audit: AuthAuditService,
  ) {}

  // ---- the two doors ----------------------------------------------------------------------------------------------

  async refundOrder(
    orderUuid: string,
    req: RefundRequest,
    operatorId: number,
  ): Promise<RefundResponse> {
    const target = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT org_id, id, kind, status, gateway_slug, gateway_payment_id, currency, total_amount
        FROM orders WHERE uuid = ${orderUuid}::uuid`);
      const o = (res.rows as Raw[])[0];
      if (!o) throw AppError.notFound('Order', orderUuid);
      if (o.status !== 'paid')
        throw refused('Only a paid order can be refunded.', 'order_not_paid');
      if (o.kind === 'wallet_topup') {
        throw refused(
          'A wallet top-up cannot be refunded here: its credit is already in the wallet.',
          'wallet_topup_not_refundable',
        );
      }
      const paymentId = typeof o.gateway_payment_id === 'string' ? o.gateway_payment_id : '';
      const gateway = typeof o.gateway_slug === 'string' ? o.gateway_slug : '';
      if (!gateway || !paymentId) {
        throw refused(
          'This order was not paid through a gateway, so there is nothing to refund there.',
          'no_gateway_payment',
        );
      }
      // A subscription's first charge stores the subscription id as the payment id: refund it from the subscription instead.
      if (/^sub_/.test(paymentId)) {
        throw refused(
          'This is a subscription payment: refund it from the subscription.',
          'use_subscription_refund',
        );
      }
      return {
        orgId: Number(o.org_id),
        orderId: Number(o.id),
        subscriptionId: null,
        gateway,
        paymentId,
        paidMinor: majorToMinor(String(o.total_amount), String(o.currency)) ?? 0n,
        currency: String(o.currency),
      } satisfies Target;
    });
    return this.refund(target, req, operatorId);
  }

  /** The subscription and what its provider says it charged (null when the provider cannot be asked). */
  private async providerCharges(subscriptionUuid: string) {
    const sub = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT org_id, id, gateway, gateway_subscription_id, gateway_plan_id, gateway_customer_id
        FROM subscriptions WHERE uuid = ${subscriptionUuid}::uuid`);
      const r = (res.rows as Raw[])[0];
      if (!r) throw AppError.notFound('Subscription', subscriptionUuid);
      return {
        orgId: Number(r.org_id),
        id: Number(r.id),
        gateway: String(r.gateway),
        gatewaySubscriptionId:
          typeof r.gateway_subscription_id === 'string' ? r.gateway_subscription_id : null,
        gatewayPlanId: typeof r.gateway_plan_id === 'string' ? r.gateway_plan_id : null,
        gatewayCustomerId: typeof r.gateway_customer_id === 'string' ? r.gateway_customer_id : null,
      };
    });
    if (!sub.gatewaySubscriptionId) {
      throw refused(
        'This subscription has no provider subscription to refund against.',
        'no_gateway_subscription',
      );
    }
    const gatewayRow = await this.gateways.bySlug(sub.gateway);
    const driver = gatewayRow ? this.gateways.driverFor(gatewayRow) : null;
    if (!driver?.listSubscriptionCharges || !driver.refundPayment) {
      throw refused('This gateway cannot refund a subscription charge.', 'gateway_cannot_refund');
    }
    const charges = await driver.listSubscriptionCharges({
      gatewaySubscriptionId: sub.gatewaySubscriptionId,
      gatewayCustomerId: sub.gatewayCustomerId,
      gatewayPlanId: sub.gatewayPlanId,
    });
    if (charges === null) {
      throw new AppError(
        ERROR_CODES.PAYGW_PROVIDER_ERROR,
        'The payment provider could not be asked for this subscription’s charges. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return { sub, charges };
  }

  /** What the provider charged this subscription, for the operator to pick a charge to refund. */
  async chargesFor(subscriptionUuid: string) {
    const { charges } = await this.providerCharges(subscriptionUuid);
    return charges.map((c) => ({
      id: c.id,
      paymentId: c.paymentId,
      amountMinor: c.amountMinor.toString(),
      currency: c.currency,
      status: c.status,
      paidAt: c.paidAt,
      receiptUrl: c.receiptUrl && c.receiptUrl.startsWith('https://') ? c.receiptUrl : null,
    }));
  }

  async refundSubscriptionCharge(
    subscriptionUuid: string,
    req: SubscriptionRefundRequest,
    operatorId: number,
  ): Promise<RefundResponse> {
    // The charge must be one the provider itself lists for THIS subscription and says was paid.
    const { sub, charges } = await this.providerCharges(subscriptionUuid);
    const charge = charges.find((c) => c.paymentId === req.paymentId && c.status === 'paid');
    if (!charge) {
      throw refused(
        'That payment is not a paid charge of this subscription.',
        'payment_not_in_subscription',
      );
    }
    const out = await this.refund(
      {
        orgId: sub.orgId,
        orderId: null,
        subscriptionId: sub.id,
        gateway: sub.gateway,
        paymentId: req.paymentId,
        paidMinor: charge.amountMinor,
        currency: charge.currency,
      },
      req,
      operatorId,
    );
    if (req.endSubscription && out.status !== 'failed') {
      await this.cancel.endOne(sub.orgId, sub.id, {
        atCycleEnd: false,
        reason: 'operator',
        actor: { id: operatorId, type: 'platform_operator' },
      });
    }
    return out;
  }

  /** Refunds recorded against an order or a subscription, newest first (what the operator screen shows). */
  async listFor(kind: 'order' | 'subscription', uuid: string) {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(
        kind === 'order'
          ? sql`SELECT r.* FROM order_refunds r JOIN orders o ON o.org_id = r.org_id AND o.id = r.order_id WHERE o.uuid = ${uuid}::uuid ORDER BY r.id DESC`
          : sql`SELECT r.* FROM order_refunds r JOIN subscriptions s ON s.org_id = r.org_id AND s.id = r.subscription_id WHERE s.uuid = ${uuid}::uuid ORDER BY r.id DESC`,
      );
      return (res.rows as Raw[]).map((r) => ({
        ...present(r),
        reason: String(r.reason),
        createdAt: new Date(String(r.created_at)).toISOString(),
      }));
    });
  }

  // ---- the shared core --------------------------------------------------------------------------------------------

  private async refund(t: Target, req: RefundRequest, operatorId: number): Promise<RefundResponse> {
    const gatewayRow = await this.gateways.bySlug(t.gateway);
    const driver = gatewayRow ? this.gateways.driverFor(gatewayRow) : null;
    if (!driver?.refundPayment) {
      throw refused('This gateway cannot refund payments.', 'gateway_cannot_refund');
    }

    // 1. Claim the amount: pending rows count, so a second request while the first is in flight sees it.
    const claimed = await this.store.tx(async (tx) => {
      const prior = await this.alreadyRefunded(tx, t);
      const room = t.paidMinor - prior;
      if (room <= 0n) throw refused('This payment is already fully refunded.', 'already_refunded');
      const amount = req.amountMinor !== undefined ? BigInt(req.amountMinor) : room;
      if (amount > room) {
        throw refused(
          `At most ${room.toString()} (minor units) can still be refunded on this payment.`,
          'more_than_paid',
        );
      }
      const res = await tx.execute(sql`
        INSERT INTO order_refunds (org_id, order_id, subscription_id, gateway, gateway_payment_id, amount_minor, currency, status, reason, created_by)
        VALUES (${t.orgId}, ${t.orderId}, ${t.subscriptionId}, ${t.gateway}, ${t.paymentId}, ${amount.toString()}::bigint,
                ${t.currency}, 'pending', ${req.reason}, ${operatorId})
        RETURNING id, uuid`);
      const row = (res.rows as Raw[])[0]!;
      return { id: Number(row.id), uuid: String(row.uuid), amount };
    });

    // 2. The provider, with no transaction open. A whole-payment refund sends no amount (Razorpay refunds what is left).
    const partial = claimed.amount !== t.paidMinor;
    const answer = await driver.refundPayment({
      paymentId: t.paymentId,
      ...(partial ? { amountMinor: claimed.amount } : {}),
      note: req.reason,
    });

    // 3. Record what it said, with the audit row and the event, in one transaction.
    return this.store.tx(async (tx) => {
      const status = answer.ok
        ? answer.status === 'processed'
          ? 'processed'
          : 'pending'
        : 'failed';
      const res = await tx.execute(sql`
        UPDATE order_refunds
        SET status = ${status}, gateway_refund_id = ${answer.refundId ?? null}, failure = ${answer.ok ? null : (answer.reason ?? 'unknown').slice(0, 500)}
        WHERE org_id = ${t.orgId} AND id = ${claimed.id}
        RETURNING *`);
      const row = (res.rows as Raw[])[0]!;
      await this.audit.record(tx, {
        event: answer.ok ? 'billing.refund.created' : 'billing.refund.failed',
        status: answer.ok ? 'success' : 'failure',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          refund: claimed.uuid,
          gateway: t.gateway,
          payment: t.paymentId,
          amountMinor: claimed.amount.toString(),
          currency: t.currency,
          status,
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'order_refunds',
        aggregateId: claimed.id,
        eventType: answer.ok ? 'paygw.refund.created' : 'paygw.refund.failed',
        orgId: t.orgId,
        payload: {
          gateway: t.gateway,
          amountMinor: claimed.amount.toString(),
          currency: t.currency,
          status,
        },
      });
      if (!answer.ok)
        this.logger.warn(
          { gateway: t.gateway, reason: answer.reason },
          'refund refused by the provider',
        );
      return present(row);
    });
  }

  /** Everything already returned (or being returned) on this payment: failed attempts do not count. */
  private async alreadyRefunded(tx: Tx, t: Target): Promise<bigint> {
    const res = await tx.execute(sql`
      SELECT COALESCE(SUM(amount_minor), 0)::text AS total FROM order_refunds
      WHERE org_id = ${t.orgId} AND gateway = ${t.gateway} AND gateway_payment_id = ${t.paymentId} AND status <> 'failed'`);
    return BigInt(String((res.rows as Raw[])[0]!.total));
  }
}

function present(r: Raw): RefundResponse {
  return {
    id: String(r.uuid),
    status: r.status as RefundResponse['status'],
    amountMinor: String(r.amount_minor),
    currency: String(r.currency),
    gatewayRefundId: typeof r.gateway_refund_id === 'string' ? r.gateway_refund_id : null,
    failure: typeof r.failure === 'string' ? r.failure : null,
  };
}
