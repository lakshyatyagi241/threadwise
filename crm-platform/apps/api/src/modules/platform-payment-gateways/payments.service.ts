import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { parseForm } from '../../infra/providers/platform-payment-gateways';
import { CheckoutSettingsService } from './checkout-settings.service';
import { FulfilmentService } from './fulfilment.service';
import { webhookSecretMissing } from './gateway-rules';
import { GatewayService } from './gateway.service';
import { majorToMinor } from './order-pricing';
import { OrdersRepository, type OrderRow } from './orders.repository';
import { PaygwStore } from './paygw.store';
import { PaymentConfirmationService } from './payment-confirmation.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

export type ReturnOutcome = 'success' | 'failed' | 'cancelled' | 'pending' | 'notfound';

/** A notification body: JSON, or form-encoded (several Indian and Asian gateways post forms). Anything else is not parsed. */
export function parseNotificationBody(raw: Buffer): unknown {
  const text = raw.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return /^[^=&\s]+=/.test(text) ? parseForm(raw) : null;
  }
}

/**
 * The two public doors a provider or a returning buyer uses (TW-PAYGW-026, 027). Neither trusts anything it is handed:
 *   - the return finds the order by OUR opaque token (not by a provider key, not by a session cookie), then asks the driver to
 *     confirm with the provider or by signature; a redirect parameter alone never marks anything paid;
 *   - the webhook is authenticated by the driver's check BEFORE anything is parsed, and fails closed when the gateway
 *     has a signing field that nobody filled in.
 * A subscription notification (renewal, cancellation, failed charge) goes to the subscription lifecycle; everything else is a
 * payment and ends in FulfilmentService.fulfil, whose conditional update makes any number of replays harmless.
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
    private readonly confirmation: PaymentConfirmationService,
    private readonly subscriptions: SubscriptionLifecycleService,
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
    const { outcome } = await this.confirmation.confirm(order, params);
    return this.webUrl(outcome, order.orderNumber);
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

    const body = parseNotificationBody(rawBody);
    if (body === null) return { ok: true };

    // A subscription event wins over a payment event, as in Reference: a renewal is not a new order.
    const evt = driver.parseSubscriptionWebhook?.(body) ?? null;
    if (evt) {
      try {
        await this.subscriptions.apply(slug, evt);
      } catch (err) {
        // Answer 500 so the provider redelivers: applying an event is idempotent, losing one is not.
        this.logger.error(
          { err, gateway: slug, type: evt.type },
          'subscription notification failed',
        );
        throw err;
      }
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
