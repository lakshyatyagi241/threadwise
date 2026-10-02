import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import {
  CANCELLED_BY_USER,
  type DriverOrder,
} from '../../infra/providers/platform-payment-gateways';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { CheckoutSettingsService } from './checkout-settings.service';
import { FulfilmentService } from './fulfilment.service';
import { webhookSecretMissing } from './gateway-rules';
import { GatewayService } from './gateway.service';
import { recordOrderEvent } from './order-events';
import { majorToMinor, minorToMajor } from './order-pricing';
import { OrdersRepository, type OrderRow } from './orders.repository';
import { PaygwStore } from './paygw.store';

export type ReturnOutcome = 'success' | 'failed' | 'cancelled' | 'pending' | 'notfound';

/** The order as a driver sees it: nothing but what it needs to charge, confirm and describe. */
export function toDriverOrder(o: OrderRow): DriverOrder {
  const minor = majorToMinor(o.totalAmount, o.currency) ?? 0n;
  return {
    orderNumber: o.orderNumber,
    amountMinor: minor,
    amountMajor: minorToMajor(minor, o.currency),
    currency: o.currency,
    description: o.kind === 'wallet_topup' ? 'Wallet top-up' : (o.planSlug ?? 'Plan'),
    customerName: o.customerName,
    customerEmail: o.customerEmail,
    gatewayOrderId: o.gatewayOrderId,
  };
}

/**
 * The two public doors a provider or a returning buyer uses (TW-PAYGW-026, 027). Neither trusts anything it is handed:
 *   - the return finds the order by OUR opaque token (not by a provider key, not by a session cookie), then asks the driver to
 *     confirm with the provider or by signature; a redirect parameter alone never marks anything paid;
 *   - the webhook is authenticated by the driver's signature check BEFORE anything is parsed, and fails closed when the gateway
 *     has a signing field that nobody filled in.
 * Both end in FulfilmentService.fulfil, whose conditional update makes any number of replays harmless.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly store: PaygwStore,
    private readonly gateways: GatewayService,
    private readonly settings: CheckoutSettingsService,
    private readonly orders: OrdersRepository,
    private readonly fulfilment: FulfilmentService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private webUrl(outcome: ReturnOutcome, order?: string): string {
    const q = new URLSearchParams({ payment: outcome });
    if (order) q.set('order', order);
    return `${this.config.get('WEB_APP_URL', { infer: true })}/billing/orders?${q.toString()}`;
  }

  // ---- the buyer comes back --------------------------------------------------------------------------------------------

  async handleReturn(slug: string, params: Record<string, string>): Promise<string> {
    const token = params.o;
    const gateway = await this.gateways.bySlug(slug);
    if (!gateway || !token) return this.webUrl('notfound');
    const order = await this.store.tx((tx) => this.orders.byReturnToken(tx, token));
    if (!order || order.gatewaySlug !== slug) return this.webUrl('notfound');
    // A buyer who reloads the return page, or a webhook that got there first: already paid is a success, never re-confirmed
    // and never overwritten by a later failing payload.
    if (order.status === 'paid') return this.webUrl('success', order.orderNumber);

    let result;
    try {
      result = await this.gateways.driverFor(gateway).confirmReturn(params, toDriverOrder(order));
    } catch (e) {
      result = {
        status: 'failed' as const,
        error: `callback_exception: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200),
      };
    }

    if (result.status === 'paid') {
      await this.fulfilment.fulfil(order, {
        gatewayPaymentId: result.gatewayPaymentId,
        payload: result.payload,
      });
      return this.webUrl('success', order.orderNumber);
    }
    if (result.status === 'pending') {
      // Reference marked these failed; the buyer may have paid and the provider simply not have settled yet.
      return this.webUrl('pending', order.orderNumber);
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
    return this.webUrl(cancelled ? 'cancelled' : 'failed', order.orderNumber);
  }

  // ---- the provider calls --------------------------------------------------------------------------------------------

  async handleWebhook(
    slug: string,
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<{ ok: true }> {
    const gateway = await this.gateways.bySlug(slug);
    if (!gateway) throw AppError.notFound('Payment gateway', slug);
    const creds = this.gateways.decryptCredentials(gateway);

    const s = await this.settings.load();
    if (s.requireWebhookSecret && webhookSecretMissing(slug, creds)) {
      this.logger.warn(
        { gateway: slug },
        'webhook rejected: no signing secret configured for this gateway',
      );
      throw new AppError(
        ERROR_CODES.PAYGW_WEBHOOK_SECRET_MISSING,
        'webhook_secret_not_configured',
        HttpStatus.FORBIDDEN,
      );
    }

    const driver = this.gateways.driverFor(gateway);
    if (!(await driver.verifyWebhook(rawBody, headers))) {
      throw new AppError(
        ERROR_CODES.PAYGW_SIGNATURE_MISMATCH,
        'signature_mismatch',
        HttpStatus.FORBIDDEN,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { ok: true };
    }
    const payment = driver.parseWebhook(body);
    if (!payment) return { ok: true };

    const order = await this.store.tx((tx) =>
      this.orders.byReference(tx, slug, {
        orderNumber: payment.orderNumber,
        gatewayOrderId: payment.gatewayOrderId,
      }),
    );
    if (!order) {
      // Always 200: a non-2xx only makes the provider retry an event we can never match. It is logged for the operator.
      this.logger.warn(
        { gateway: slug, ref: payment.orderNumber ?? payment.gatewayOrderId },
        'webhook matched no order',
      );
      return { ok: true };
    }
    if (!this.amountMatches(order, payment)) {
      this.logger.error(
        { order: order.orderNumber, gateway: slug },
        'webhook amount does not match the order; ignored',
      );
      return { ok: true };
    }
    await this.fulfilment.fulfil(order, {
      gatewayPaymentId: payment.gatewayPaymentId,
      payload: payment.payload,
    });
    return { ok: true };
  }

  private amountMatches(order: OrderRow, p: { amountMinor?: bigint; currency?: string }): boolean {
    if (p.amountMinor === undefined && p.currency === undefined) return true;
    const expected = majorToMinor(order.totalAmount, order.currency);
    return (
      (p.amountMinor === undefined || p.amountMinor === expected) &&
      (p.currency === undefined || p.currency === order.currency)
    );
  }
}
