import {
  CANCELLED_BY_USER,
  asRecord,
  basicAuth,
  brief,
  failed,
  hmacHex,
  isOk,
  paid,
  pending,
  safeEqual,
  str,
  type DriverContext,
  type DriverOrder,
  type DriverUrls,
  type PaymentDriver,
  type PaymentResult,
  type WebhookPayment,
} from './payment-driver';

const API = 'https://api.stripe.com/v1';
/** Stripe's own recommended tolerance for the signed timestamp (WaDesk had none and a captured request replayed forever). */
export const STRIPE_TOLERANCE_SECONDS = 300;

const form = (entries: Array<[string, string]>): string => new URLSearchParams(entries).toString();

/**
 * Stripe Checkout Sessions (WD-PAYGW-014): hosted page, plain REST, no SDK. One-time payments only; recurring is WD-PAYGW-012.
 * Our order number rides in `client_reference_id` and metadata, so the webhook can finalise an order whose buyer never returned.
 */
export class StripeDriver implements PaymentDriver {
  readonly slug = 'stripe';

  constructor(
    private readonly ctx: DriverContext,
    private readonly now: () => number = Date.now,
  ) {}

  private get auth(): Record<string, string> {
    return {
      Authorization: basicAuth(this.ctx.credentials.secret_key ?? '', ''),
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  }

  async initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    if (!this.ctx.credentials.secret_key) return failed('stripe_secret_key_missing');
    const sep = urls.returnUrl.includes('?') ? '&' : '?';
    const entries: Array<[string, string]> = [
      ['mode', 'payment'],
      ['client_reference_id', order.orderNumber],
      ['metadata[order_number]', order.orderNumber],
      ['payment_intent_data[metadata][order_number]', order.orderNumber],
      ['line_items[0][quantity]', '1'],
      ['line_items[0][price_data][currency]', order.currency.toLowerCase()],
      ['line_items[0][price_data][unit_amount]', order.amountMinor.toString()],
      ['line_items[0][price_data][product_data][name]', order.description],
      // The placeholder is Stripe's, not ours: Stripe substitutes the session id.
      ['success_url', `${urls.returnUrl}${sep}session_id={CHECKOUT_SESSION_ID}`],
      ['cancel_url', `${urls.returnUrl}${sep}cancelled=1`],
    ];
    if (order.customerEmail) entries.push(['customer_email', order.customerEmail]);
    try {
      const res = await this.ctx.http(`${API}/checkout/sessions`, {
        method: 'POST',
        headers: this.auth,
        body: form(entries),
      });
      const body = asRecord(res.json);
      if (!isOk(res) || !str(body.url)) {
        return failed(
          `stripe_http_${res.status}: ${str(asRecord(body.error).message) ?? 'no session url'}`,
        );
      }
      return pending({
        redirectUrl: str(body.url),
        gatewayOrderId: str(body.id),
        payload: { session_id: body.id },
      });
    } catch (e) {
      return failed(`stripe_exception: ${brief(e)}`);
    }
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    if (params.cancelled) return failed(CANCELLED_BY_USER);
    const sessionId = params.session_id;
    if (!sessionId) return failed('missing_session_id');
    // The session must be the one we created for this order; a paid session of another order proves nothing here.
    if (order.gatewayOrderId && order.gatewayOrderId !== sessionId)
      return failed('stripe_session_mismatch');
    try {
      const res = await this.ctx.http(`${API}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        headers: this.auth,
      });
      const s = asRecord(res.json);
      if (!isOk(res)) return failed(`stripe_http_${res.status}`);
      if (s.client_reference_id !== order.orderNumber) return failed('stripe_reference_mismatch');
      if (s.payment_status !== 'paid')
        return pending({ error: `payment_status: ${String(s.payment_status)}` });
      if (
        BigInt(Number(s.amount_total ?? -1)) !== order.amountMinor ||
        str(s.currency)?.toUpperCase() !== order.currency
      ) {
        return failed('stripe_amount_mismatch', { session: s });
      }
      return paid(str(s.payment_intent), { session: s });
    } catch (e) {
      return failed(`stripe_exception: ${brief(e)}`);
    }
  }

  /**
   * `Stripe-Signature: t=<unix>,v1=<hmac>`; the HMAC is SHA-256 over `<t>.<raw body>` keyed with the endpoint secret. A missing
   * secret or header rejects (WaDesk accepted both); a timestamp outside the tolerance rejects (replay).
   */
  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    const secret = this.ctx.credentials.webhook_secret;
    const header = headers['stripe-signature'];
    if (!secret || !header) return false;
    const parts = new Map<string, string[]>();
    for (const piece of header.split(',')) {
      const [k, v] = piece.split('=');
      if (k && v) parts.set(k.trim(), [...(parts.get(k.trim()) ?? []), v.trim()]);
    }
    const t = Number(parts.get('t')?.[0]);
    if (!Number.isFinite(t) || Math.abs(this.now() / 1000 - t) > STRIPE_TOLERANCE_SECONDS)
      return false;
    const expected = hmacHex('sha256', secret, `${t}.${rawBody.toString('utf8')}`);
    return (parts.get('v1') ?? []).some((sig) => safeEqual(sig, expected));
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const evt = asRecord(body);
    if (
      evt.type !== 'checkout.session.completed' &&
      evt.type !== 'checkout.session.async_payment_succeeded'
    )
      return null;
    const s = asRecord(asRecord(evt.data).object);
    if (s.payment_status !== 'paid') return null;
    return {
      orderNumber: str(s.client_reference_id),
      gatewayOrderId: str(s.id),
      gatewayPaymentId: str(s.payment_intent),
      amountMinor: typeof s.amount_total === 'number' ? BigInt(s.amount_total) : undefined,
      currency: str(s.currency)?.toUpperCase(),
      payload: { session: s },
    };
  }
}
