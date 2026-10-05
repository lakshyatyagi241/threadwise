import {
  CANCELLED_BY_USER,
  asRecord,
  basicAuth,
  brief,
  failed,
  isOk,
  paid,
  str,
  pending,
  type DriverContext,
  type DriverOrder,
  type DriverUrls,
  type PaymentDriver,
  type CancelResult,
  type PaymentResult,
  type SubscriptionEvent,
  type SubscriptionRef,
  type WebhookPayment,
} from './payment-driver';
import { majorToMinor } from '@crm/contracts';

const base = (mode: string): string =>
  mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

/**
 * PayPal Orders v2 (WD-PAYGW-016): create, the buyer approves on PayPal, the return captures. Notifications are verified with
 * PayPal's own verify-webhook-signature call against the operator's webhook id (WaDesk verified nothing).
 */
export class PayPalDriver implements PaymentDriver {
  readonly slug = 'paypal';

  constructor(private readonly ctx: DriverContext) {}

  private async token(): Promise<string> {
    const { client_id: id, client_secret: secret } = this.ctx.credentials;
    const res = await this.ctx.http(`${base(this.ctx.mode)}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(id ?? '', secret ?? ''),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const t = str(asRecord(res.json).access_token);
    if (!isOk(res) || !t) throw new Error(`paypal_auth_http_${res.status}`);
    return t;
  }

  private async api(method: string, path: string, body?: unknown) {
    const token = await this.token();
    return this.ctx.http(`${base(this.ctx.mode)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    if (!this.ctx.credentials.client_id || !this.ctx.credentials.client_secret)
      return failed('paypal_credentials_missing');
    const sep = urls.returnUrl.includes('?') ? '&' : '?';
    try {
      const res = await this.api('POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: order.orderNumber,
            custom_id: order.orderNumber,
            description: order.description.slice(0, 120),
            amount: { currency_code: order.currency, value: order.amountMajor },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: urls.returnUrl,
              cancel_url: `${urls.returnUrl}${sep}cancelled=1`,
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
            },
          },
        },
      });
      const body = asRecord(res.json);
      const links = Array.isArray(body.links) ? body.links.map(asRecord) : [];
      const approve = links.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
      const id = str(body.id);
      if (!isOk(res) || !id || !str(approve?.href)) {
        return failed(`paypal_http_${res.status}: ${str(body.message) ?? 'no approval link'}`);
      }
      return pending({
        redirectUrl: str(approve?.href),
        gatewayOrderId: id,
        payload: { paypal_order_id: id },
      });
    } catch (e) {
      return failed(`paypal_exception: ${brief(e)}`);
    }
  }

  /** Money moves here: the return captures the approved order, and only a COMPLETED capture of the right amount is paid. */
  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    if (params.cancelled) return failed(CANCELLED_BY_USER);
    // A subscription approval returns ?subscription_id=I-... instead of ?token=.
    if (params.subscription_id) return this.confirmSubscription(params.subscription_id, order);
    const token = params.token;
    if (!token) return failed('missing_paypal_token');
    if (order.gatewayOrderId && order.gatewayOrderId !== token)
      return failed('paypal_order_mismatch');
    try {
      let res = await this.api('POST', `/v2/checkout/orders/${encodeURIComponent(token)}/capture`);
      let body = asRecord(res.json);
      // A reload of the return page captures twice: the second call answers 422 ORDER_ALREADY_CAPTURED, so read the order instead.
      const issue = JSON.stringify(body.details ?? '');
      if (res.status === 422 && issue.includes('ORDER_ALREADY_CAPTURED')) {
        res = await this.api('GET', `/v2/checkout/orders/${encodeURIComponent(token)}`);
        body = asRecord(res.json);
      }
      if (!isOk(res)) return failed(`paypal_http_${res.status}`);
      if (body.status !== 'COMPLETED')
        return failed(`paypal_status: ${String(body.status)}`, { paypal: body });
      const unit = asRecord(Array.isArray(body.purchase_units) ? body.purchase_units[0] : null);
      const capture = asRecord(
        Array.isArray(asRecord(unit.payments).captures)
          ? (asRecord(unit.payments).captures as unknown[])[0]
          : null,
      );
      const amount = asRecord(capture.amount);
      if (
        str(capture.status) !== 'COMPLETED' ||
        str(amount.currency_code) !== order.currency ||
        majorToMinor(str(amount.value) ?? '', order.currency) !== order.amountMinor
      ) {
        return failed('paypal_amount_mismatch', { paypal: body });
      }
      return paid(str(capture.id), { paypal: body });
    } catch (e) {
      return failed(`paypal_exception: ${brief(e)}`);
    }
  }

  private async confirmSubscription(
    subscriptionId: string,
    order: DriverOrder,
  ): Promise<PaymentResult> {
    if (order.gatewayOrderId && order.gatewayOrderId !== subscriptionId)
      return failed('paypal_order_mismatch');
    try {
      const res = await this.api(
        'GET',
        `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
      );
      if (!isOk(res)) return failed(`paypal_subscription_fetch: ${res.status}`);
      const body = asRecord(res.json);
      if (body.custom_id !== order.orderNumber) return failed('paypal_reference_mismatch');
      if (body.status !== 'ACTIVE' && body.status !== 'APPROVED')
        return failed(`paypal_subscription_status: ${String(body.status)}`, { paypal: body });
      return paid(str(body.id) ?? subscriptionId, {
        paypal: body,
        gateway_subscription_id: subscriptionId,
        current_period_end: str(asRecord(body.billing_info).next_billing_time),
      });
    } catch (e) {
      return failed(`paypal_subscription_confirm_exception: ${brief(e)}`);
    }
  }

  supportsRecurring(): boolean {
    return true;
  }

  /** Product, plan, then the subscription whose approval link the buyer follows. Orphan products and plans accumulate (as in WaDesk). */
  async createSubscription(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    if (!this.ctx.credentials.client_id || !this.ctx.credentials.client_secret)
      return failed('paypal_credentials_missing');
    const sep = urls.returnUrl.includes('?') ? '&' : '?';
    const rec = order.recurring ?? { interval: 'month' as const, count: 1 };
    const msg = (j: unknown, status: number): string =>
      str(asRecord(j).message) ?? `HTTP ${status}`;
    try {
      const prod = await this.api('POST', '/v1/catalogs/products', {
        name: 'Subscription',
        type: 'SERVICE',
        category: 'SOFTWARE',
      });
      const productId = str(asRecord(prod.json).id);
      if (!isOk(prod) || !productId)
        return failed(`paypal_product: ${msg(prod.json, prod.status)}`);
      const planRes = await this.api('POST', '/v1/billing/plans', {
        product_id: productId,
        name: order.planName ?? order.description,
        status: 'ACTIVE',
        billing_cycles: [
          {
            frequency: { interval_unit: rec.interval.toUpperCase(), interval_count: rec.count },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: {
              fixed_price: { value: order.amountMajor, currency_code: order.currency },
            },
          },
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: 'CONTINUE',
          payment_failure_threshold: 1,
        },
      });
      const planId = str(asRecord(planRes.json).id);
      if (!isOk(planRes) || !planId)
        return failed(`paypal_plan: ${msg(planRes.json, planRes.status)}`);
      const subRes = await this.api('POST', '/v1/billing/subscriptions', {
        plan_id: planId,
        custom_id: order.orderNumber,
        application_context: {
          return_url: urls.returnUrl,
          cancel_url: `${urls.returnUrl}${sep}cancelled=1`,
          user_action: 'SUBSCRIBE_NOW',
          shipping_preference: 'NO_SHIPPING',
        },
      });
      const sub = asRecord(subRes.json);
      const links = Array.isArray(sub.links) ? sub.links.map(asRecord) : [];
      const approve = str(links.find((l) => l.rel === 'approve')?.href);
      if (!isOk(subRes) || !approve || !str(sub.id))
        return failed(`paypal_subscription: ${str(sub.message) ?? 'paypal_no_approve_link'}`);
      return pending({
        redirectUrl: approve,
        gatewayOrderId: str(sub.id),
        payload: { gateway_subscription_id: str(sub.id), gateway_plan_id: planId },
      });
    } catch (e) {
      return failed(`paypal_subscription_exception: ${brief(e)}`);
    }
  }

  parseSubscriptionWebhook(body: unknown): SubscriptionEvent | null {
    const evt = asRecord(body);
    const res = asRecord(evt.resource);
    switch (evt.event_type) {
      case 'PAYMENT.SALE.COMPLETED':
        return str(res.billing_agreement_id)
          ? {
              type: 'renewed',
              subscriptionId: str(res.billing_agreement_id) ?? null,
              paymentId: str(res.id),
            }
          : null;
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        return {
          type: 'created',
          subscriptionId: str(res.id) ?? null,
          periodEnd: str(asRecord(res.billing_info).next_billing_time) ?? null,
          orderNumber: str(res.custom_id) ?? null,
        };
      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.EXPIRED':
        return { type: 'canceled', subscriptionId: str(res.id) ?? null };
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
        return { type: 'payment_failed', subscriptionId: str(res.id) ?? null };
      default:
        return null;
    }
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    const webhookId = this.ctx.credentials.webhook_id;
    const h = headers;
    if (!webhookId || !h['paypal-transmission-sig'] || !h['paypal-transmission-id']) return false;
    try {
      const res = await this.api('POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: h['paypal-auth-algo'],
        cert_url: h['paypal-cert-url'],
        transmission_id: h['paypal-transmission-id'],
        transmission_sig: h['paypal-transmission-sig'],
        transmission_time: h['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: JSON.parse(rawBody.toString('utf8')),
      });
      return isOk(res) && asRecord(res.json).verification_status === 'SUCCESS';
    } catch {
      return false;
    }
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const evt = asRecord(body);
    if (evt.event_type !== 'PAYMENT.CAPTURE.COMPLETED') return null;
    const cap = asRecord(evt.resource);
    if (cap.status !== 'COMPLETED') return null;
    const amount = asRecord(cap.amount);
    const related = asRecord(asRecord(cap.supplementary_data).related_ids);
    const currency = str(amount.currency_code);
    return {
      orderNumber: str(cap.custom_id),
      gatewayOrderId: str(related.order_id),
      gatewayPaymentId: str(cap.id),
      amountMinor: currency
        ? (majorToMinor(str(amount.value) ?? '', currency) ?? undefined)
        : undefined,
      currency,
      payload: { paypal_capture: cap },
    };
  }

  /** PayPal: cancelling a billing subscription ends renewal; the buyer keeps what they paid for. */
  async cancelSubscription(ref: SubscriptionRef): Promise<CancelResult> {
    if (!this.ctx.credentials.client_id || !this.ctx.credentials.client_secret)
      return { ok: false, reason: 'paypal_credentials_missing' };
    try {
      const res = await this.api(
        'POST',
        `/v1/billing/subscriptions/${encodeURIComponent(ref.gatewaySubscriptionId)}/cancel`,
        { reason: 'Customer cancelled auto-renew' },
      );
      return isOk(res) ? { ok: true } : { ok: false, reason: `paypal_http_${res.status}` };
    } catch (e) {
      return { ok: false, reason: `paypal_exception: ${brief(e)}` };
    }
  }
}
