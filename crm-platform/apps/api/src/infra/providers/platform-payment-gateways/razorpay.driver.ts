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
  type CancelResult,
  type PaymentResult,
  type SubscriptionRef,
  type WebhookPayment,
} from './payment-driver';

const API = 'https://api.razorpay.com/v1';

/**
 * Razorpay Standard Checkout (TW-PAYGW-015): the server creates a Razorpay order, the browser opens the Razorpay modal with
 * the returned parameters (a client action, never server HTML) and posts the signed result back to the return URL.
 * One-time payments only; subscriptions are TW-PAYGW-012.
 */
export class RazorpayDriver implements PaymentDriver {
  readonly slug = 'razorpay';

  constructor(private readonly ctx: DriverContext) {}

  private get auth(): Record<string, string> {
    return {
      Authorization: basicAuth(
        this.ctx.credentials.key_id ?? '',
        this.ctx.credentials.key_secret ?? '',
      ),
      'Content-Type': 'application/json',
    };
  }

  async initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    const { key_id: keyId, key_secret: secret } = this.ctx.credentials;
    if (!keyId || !secret) return failed('razorpay_credentials_missing');
    try {
      const res = await this.ctx.http(`${API}/orders`, {
        method: 'POST',
        headers: this.auth,
        body: JSON.stringify({
          amount: Number(order.amountMinor),
          currency: order.currency,
          receipt: order.orderNumber,
          notes: { order_number: order.orderNumber },
        }),
      });
      const body = asRecord(res.json);
      const id = str(body.id);
      if (!isOk(res) || !id) {
        return failed(
          `razorpay_http_${res.status}: ${str(asRecord(body.error).description) ?? 'no order id'}`,
        );
      }
      return pending({
        gatewayOrderId: id,
        payload: { razorpay_order_id: id },
        clientAction: {
          provider: 'razorpay',
          params: {
            keyId,
            orderId: id,
            amountMinor: Number(order.amountMinor),
            currency: order.currency,
            name: order.description,
            description: order.orderNumber,
            prefillName: order.customerName ?? '',
            prefillEmail: order.customerEmail ?? '',
            callbackUrl: urls.returnUrl,
          },
        },
      });
    } catch (e) {
      return failed(`razorpay_exception: ${brief(e)}`);
    }
  }

  /**
   * Signature only, as Razorpay documents: HMAC-SHA256 of `order_id|payment_id` with the key secret. A dismissed modal sends
   * `cancelled=1` and is a decline, not a fault (Reference burned the order with `missing_razorpay_params`).
   */
  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    if (params.cancelled) return failed(CANCELLED_BY_USER);
    const orderId = params.razorpay_order_id;
    const paymentId = params.razorpay_payment_id;
    const signature = params.razorpay_signature;
    if (!orderId || !paymentId || !signature) return failed('missing_razorpay_params');
    if (order.gatewayOrderId && order.gatewayOrderId !== orderId)
      return failed('razorpay_order_mismatch');
    const expected = hmacHex(
      'sha256',
      this.ctx.credentials.key_secret ?? '',
      `${orderId}|${paymentId}`,
    );
    if (!safeEqual(signature, expected)) return failed('razorpay_signature_mismatch');
    return paid(paymentId, { razorpay_order_id: orderId, razorpay_payment_id: paymentId });
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    const secret = this.ctx.credentials.webhook_secret;
    const header = headers['x-razorpay-signature'];
    if (!secret || !header) return false;
    return safeEqual(header, hmacHex('sha256', secret, rawBody));
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const evt = asRecord(body);
    if (evt.event !== 'payment.captured' && evt.event !== 'order.paid') return null;
    const payment = asRecord(asRecord(asRecord(evt.payload).payment).entity);
    const notes = asRecord(payment.notes);
    const amount = payment.amount;
    return {
      orderNumber: str(notes.order_number),
      gatewayOrderId: str(payment.order_id),
      gatewayPaymentId: str(payment.id),
      amountMinor: typeof amount === 'number' ? BigInt(amount) : undefined,
      currency: str(payment.currency)?.toUpperCase(),
      payload: { razorpay_payment: payment },
    };
  }

  /** Razorpay: `cancel_at_cycle_end: 1` keeps the cycle already paid and stops the next charge. */
  async cancelSubscription(ref: SubscriptionRef): Promise<CancelResult> {
    if (!this.ctx.credentials.key_id || !this.ctx.credentials.key_secret)
      return { ok: false, reason: 'razorpay_credentials_missing' };
    try {
      const res = await this.ctx.http(
        `${API}/subscriptions/${encodeURIComponent(ref.gatewaySubscriptionId)}/cancel`,
        { method: 'POST', headers: this.auth, body: JSON.stringify({ cancel_at_cycle_end: 1 }) },
      );
      return isOk(res) ? { ok: true } : { ok: false, reason: `razorpay_http_${res.status}` };
    } catch (e) {
      return { ok: false, reason: `razorpay_exception: ${brief(e)}` };
    }
  }
}
