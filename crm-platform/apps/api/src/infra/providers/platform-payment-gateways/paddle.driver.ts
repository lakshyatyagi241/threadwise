import {
  JSON_HEADERS,
  asRecord,
  bearer,
  brief,
  failed,
  guard,
  header,
  hmacHex,
  isOk,
  minorMatches,
  paid,
  pending,
  safeEqual,
  str,
  type CancelResult,
  type DriverContext,
  type DriverOrder,
  type DriverUrls,
  type PaymentDriver,
  type PaymentResult,
  type SubscriptionEvent,
  type SubscriptionRef,
  type WebhookPayment,
} from './payment-driver';

const SANDBOX = 'https://sandbox-api.paddle.com';
const LIVE = 'https://api.paddle.com';
export const PADDLE_TOLERANCE_SECONDS = 300;

const grandTotal = (d: Record<string, unknown>): string | undefined => {
  const t =
    asRecord(asRecord(d.details).totals).grand_total ?? asRecord(asRecord(d.details).totals).total;
  return typeof t === 'string' || typeof t === 'number' ? String(t) : undefined;
};

/** Paddle Billing (WD-PAYGW-017). WaDesk's built-in overlay page becomes a `paddle` client action the web app runs. */
export class PaddleDriver implements PaymentDriver {
  readonly slug = 'paddle';

  constructor(
    private readonly ctx: DriverContext,
    private readonly now: () => number = Date.now,
  ) {}

  /** Pasted keys carry quotes, "Bearer " and invisible characters (WaDesk cleaned them the same way). */
  private get apiKey(): string {
    return (this.ctx.credentials.api_key ?? '')
      .trim()
      .replace(/^bearer\s+/i, '')
      .replace(/^["']+|["']+$/g, '')
      .replace(/[^\x21-\x7E]/g, '');
  }

  private get clientToken(): string {
    return (this.ctx.credentials.client_token ?? '')
      .trim()
      .replace(/^["']+|["']+$/g, '')
      .replace(/[^\x21-\x7E]/g, '');
  }

  /** The key's own prefix decides the environment; the gateway mode only breaks a tie. */
  private get base(): string {
    const k = this.apiKey;
    if (k.startsWith('pdl_sdbx_')) return SANDBOX;
    if (k.startsWith('pdl_live_')) return LIVE;
    return this.ctx.mode === 'live' ? LIVE : SANDBOX;
  }

  private get headers(): Record<string, string> {
    return { ...JSON_HEADERS, Authorization: bearer(this.apiKey) };
  }

  private keyProblem(): string | null {
    const key = this.apiKey;
    if (!key || !(this.ctx.credentials.product_id ?? '').trim())
      return 'paddle_credentials_missing';
    if (key.startsWith('pdl_') && ![69, 50].includes(key.length)) {
      return `paddle: Your Paddle API key is incomplete (${key.length} characters, a key is 69). Copy the whole key with the copy button in Paddle > Developer Tools > Authentication.`;
    }
    return null;
  }

  private async create(
    order: DriverOrder,
    recurring: boolean,
    urls: DriverUrls,
  ): Promise<PaymentResult> {
    const problem = this.keyProblem();
    if (problem) return failed(problem);
    const rec = order.recurring;
    const res = await this.ctx.http(`${this.base}/transactions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        items: [
          {
            price: {
              description: `Order #${order.orderNumber}`,
              product_id: (this.ctx.credentials.product_id ?? '').trim(),
              billing_cycle:
                recurring && rec ? { interval: rec.interval, frequency: rec.count } : null,
              unit_price: { amount: order.amountMinor.toString(), currency_code: order.currency },
            },
            quantity: 1,
          },
        ],
        ...(recurring ? { collection_mode: 'automatic' } : {}),
        custom_data: { order_number: order.orderNumber },
      }),
    });
    const json = asRecord(res.json);
    const data = asRecord(json.data);
    const txn = str(data.id);
    // The overlay is how a buyer pays when the Paddle account has no default payment link.
    if (txn && this.clientToken && !recurring) {
      return pending({
        gatewayOrderId: txn,
        payload: { transaction_id: txn },
        clientAction: {
          provider: 'paddle',
          params: {
            clientToken: this.clientToken,
            environment: this.base === SANDBOX ? 'sandbox' : 'production',
            transactionId: txn,
            // The overlay sends the buyer here once paid; the transaction id rides along for the server-side check.
            returnUrl: `${urls.returnUrl}${urls.returnUrl.includes('?') ? '&' : '?'}transaction_id=${encodeURIComponent(txn)}`,
          },
        },
      });
    }
    const url = str(asRecord(data.checkout).url);
    if (url)
      return pending({ redirectUrl: url, gatewayOrderId: txn, payload: { transaction_id: txn } });
    const err = asRecord(json.error);
    const reason = `${str(err.code) ?? ''} ${str(err.detail) ?? ''}`.trim();
    return failed(`paddle: ${reason || `HTTP ${res.status}`}`);
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('paddle', () => this.create(order, false, urls));
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const txn = params.transaction_id ?? params._ptxn;
    if (!txn) return pending({ error: 'paddle_transaction_missing' });
    if (order.gatewayOrderId && order.gatewayOrderId !== txn)
      return failed('paddle_transaction_mismatch');
    // WaDesk trusted `status=completed` in the query string, which any buyer can type. Always ask Paddle.
    if (!this.apiKey) return pending({ gatewayPaymentId: txn, error: 'paddle_api_key_missing' });
    return guard('paddle', async () => {
      const res = await this.ctx.http(`${this.base}/transactions/${encodeURIComponent(txn)}`, {
        method: 'GET',
        headers: this.headers,
      });
      if (!isOk(res)) return pending({ gatewayPaymentId: txn, error: `paddle_http_${res.status}` });
      const d = asRecord(asRecord(res.json).data);
      const status = str(d.status) ?? '';
      if (asRecord(d.custom_data).order_number !== order.orderNumber)
        return failed('paddle_reference_mismatch');
      if (status !== 'completed' && status !== 'paid')
        return pending({ gatewayPaymentId: txn, error: `paddle_status: ${status || 'unknown'}` });
      if (!minorMatches(order, grandTotal(d), d.currency_code))
        return failed('paddle_amount_mismatch');
      return paid(txn, { transaction: d });
    });
  }

  /** `Paddle-Signature: ts=<unix>;h1=<hmac>`, SHA-256 over `<ts>:<raw body>`. WaDesk accepted an unsigned call when no secret was set. */
  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    const secret = this.ctx.credentials.webhook_secret;
    const sig = header(headers, 'paddle-signature');
    if (!secret || !sig) return false;
    const parts = new Map(sig.split(';').map((p) => p.split('=', 2) as [string, string]));
    const ts = Number(parts.get('ts'));
    const h1 = parts.get('h1');
    if (!h1 || !Number.isFinite(ts) || Math.abs(this.now() / 1000 - ts) > PADDLE_TOLERANCE_SECONDS)
      return false;
    return safeEqual(
      hmacHex('sha256', secret, `${parts.get('ts')}:${rawBody.toString('utf8')}`),
      h1,
    );
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const evt = asRecord(body);
    if (evt.event_type !== 'transaction.completed') return null;
    const d = asRecord(evt.data);
    const total = grandTotal(d);
    return {
      orderNumber: str(asRecord(d.custom_data).order_number),
      gatewayOrderId: str(d.id),
      gatewayPaymentId: str(d.id),
      amountMinor: total && /^\d+$/.test(total) ? BigInt(total) : undefined,
      currency: str(d.currency_code)?.toUpperCase(),
      payload: { transaction: d },
    };
  }

  supportsRecurring(): boolean {
    return true;
  }

  createSubscription(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('paddle_subscription', () => this.create(order, true, urls));
  }

  parseSubscriptionWebhook(body: unknown): SubscriptionEvent | null {
    const evt = asRecord(body);
    const d = asRecord(evt.data);
    const orderNumber = str(asRecord(d.custom_data).order_number) ?? null;
    switch (evt.event_type) {
      case 'transaction.completed':
        return d.subscription_id
          ? {
              type: 'renewed',
              subscriptionId: str(d.subscription_id) ?? null,
              paymentId: str(d.id),
              orderNumber,
            }
          : null;
      case 'subscription.created':
      case 'subscription.activated':
        return {
          type: 'created',
          subscriptionId: str(d.id) ?? null,
          periodEnd:
            str(asRecord(d.current_billing_period).ends_at) ?? str(d.next_billed_at) ?? null,
          orderNumber,
        };
      case 'subscription.canceled':
        return { type: 'canceled', subscriptionId: str(d.id) ?? null, orderNumber };
      case 'transaction.payment_failed':
        return d.subscription_id
          ? {
              type: 'payment_failed',
              subscriptionId: str(d.subscription_id) ?? null,
              paymentId: str(d.id),
              orderNumber,
            }
          : null;
      default:
        return null;
    }
  }

  async cancelSubscription(ref: SubscriptionRef): Promise<CancelResult> {
    if (!this.apiKey) return { ok: false, reason: 'paddle_api_key_missing' };
    try {
      const res = await this.ctx.http(
        `${this.base}/subscriptions/${encodeURIComponent(ref.gatewaySubscriptionId)}/cancel`,
        {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ effective_from: 'next_billing_period' }),
        },
      );
      return isOk(res) ? { ok: true } : { ok: false, reason: `paddle_cancel: HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, reason: `paddle_cancel_exception: ${brief(e)}` };
    }
  }
}
