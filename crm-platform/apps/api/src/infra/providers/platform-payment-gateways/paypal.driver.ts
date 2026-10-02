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
  type PaymentResult,
  type WebhookPayment,
} from './payment-driver';
import { majorToMinor } from '@crm/contracts';

const base = (mode: string): string =>
  mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

/**
 * PayPal Orders v2 (TW-PAYGW-016): create, the buyer approves on PayPal, the return captures. Notifications are verified with
 * PayPal's own verify-webhook-signature call against the operator's webhook id (Reference verified nothing).
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
}
