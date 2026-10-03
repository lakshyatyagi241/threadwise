import {
  CANCELLED_BY_USER,
  JSON_HEADERS,
  asRecord,
  bearer,
  failed,
  guard,
  header,
  hmacHex,
  isOk,
  minorOf,
  moneyMatches,
  notificationFields,
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

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Provider ids arrive as strings or as JSON numbers (Lemon Squeezy's attributes.subscription_id is a number). */
const idOf = (v: unknown): string | null =>
  typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null;
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : 'error').slice(0, 200);

// ---- Lemon Squeezy -----------------------------------------------------------------------------------------------------

const LS = 'https://api.lemonsqueezy.com/v1';
const JSON_API = 'application/vnd.api+json';

/**
 * Lemon Squeezy (WD-PAYGW-018): hosted checkout with a custom price on a pre-created variant. WaDesk never forwarded the
 * `X-Signature` header, so no notification was ever accepted and every one-time return was marked failed. Here the header is
 * verified (HMAC-SHA256, required), the buyer's return leaves the order pending, and the signed `order_created` (status paid)
 * finalises it, matched by the order number we put in the checkout's custom data.
 */
export class LemonSqueezyDriver implements PaymentDriver {
  readonly slug = 'lemonsqueezy';

  constructor(private readonly ctx: DriverContext) {}

  private checkout(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('lemonsqueezy', async () => {
      const { api_key: key, store_id: store, variant_id: variant } = this.ctx.credentials;
      if (!key || !store || !variant) return failed('lemonsqueezy_credentials_missing');
      const res = await this.ctx.http(`${LS}/checkouts`, {
        method: 'POST',
        headers: { Authorization: bearer(key), Accept: JSON_API, 'Content-Type': JSON_API },
        body: JSON.stringify({
          data: {
            type: 'checkouts',
            attributes: {
              custom_price: Number(order.amountMinor),
              product_options: { redirect_url: urls.returnUrl },
              checkout_data: {
                email: order.customerEmail ?? '',
                custom: { order_number: order.orderNumber },
              },
            },
            relationships: {
              store: { data: { type: 'stores', id: store } },
              variant: { data: { type: 'variants', id: variant } },
            },
          },
        }),
      });
      const j = asRecord(res.json);
      const data = asRecord(j.data);
      const url = str(asRecord(data.attributes).url);
      if (url) return pending({ redirectUrl: url, gatewayOrderId: str(data.id) });
      const e = asRecord(asArray(j.errors)[0]);
      return failed(`lemonsqueezy: ${str(e.detail) ?? str(e.title) ?? 'create_failed'}`);
    });
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return this.checkout(order, urls);
  }

  /** The redirect proves nothing; the signed notification is what confirms. Never marked failed on return. */
  async confirmReturn(): Promise<PaymentResult> {
    return pending();
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    const secret = this.ctx.credentials.signing_secret ?? '';
    const sig = header(headers, 'x-signature');
    return !!secret && !!sig && safeEqual(hmacHex('sha256', secret, rawBody), sig);
  }

  private meta(body: unknown): {
    event: string;
    custom: Record<string, unknown>;
    data: Record<string, unknown>;
    attrs: Record<string, unknown>;
  } {
    const b = asRecord(body);
    const meta = asRecord(b.meta);
    const data = asRecord(b.data);
    return {
      event: str(meta.event_name) ?? '',
      custom: asRecord(meta.custom_data),
      data,
      attrs: asRecord(data.attributes),
    };
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const { event, custom, data, attrs } = this.meta(body);
    if (event !== 'order_created' || (str(attrs.status) ?? '').toLowerCase() !== 'paid')
      return null;
    return {
      orderNumber: str(custom.order_number),
      gatewayPaymentId: str(data.id),
      payload: { order: { id: data.id, status: attrs.status } },
    };
  }

  supportsRecurring(): boolean {
    return true;
  }

  createSubscription(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return this.checkout(order, urls);
  }

  parseSubscriptionWebhook(body: unknown): SubscriptionEvent | null {
    const { event, custom, data, attrs } = this.meta(body);
    const orderNumber = str(custom.order_number) ?? null;
    const subOf = idOf(attrs.subscription_id);
    switch (event) {
      case 'subscription_created':
        return {
          type: 'created',
          subscriptionId: str(data.id) ?? null,
          periodEnd: str(attrs.renews_at) ?? null,
          orderNumber,
        };
      case 'subscription_payment_success':
      case 'subscription_payment_recovered':
        if (!subOf) return null;
        return {
          type: 'renewed',
          subscriptionId: subOf,
          paymentId: str(data.id) ?? null,
          orderNumber,
        };
      case 'subscription_cancelled':
      case 'subscription_expired':
        return { type: 'canceled', subscriptionId: str(data.id) ?? subOf, orderNumber };
      case 'subscription_payment_failed':
        if (!subOf) return null;
        return {
          type: 'payment_failed',
          subscriptionId: subOf,
          paymentId: str(data.id) ?? null,
          orderNumber,
        };
      default:
        return null;
    }
  }

  async cancelSubscription(ref: SubscriptionRef): Promise<CancelResult> {
    const key = this.ctx.credentials.api_key;
    if (!key) return { ok: false, reason: 'lemonsqueezy_api_key_missing' };
    try {
      const res = await this.ctx.http(
        `${LS}/subscriptions/${encodeURIComponent(ref.gatewaySubscriptionId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: bearer(key), Accept: JSON_API },
        },
      );
      return isOk(res) ? { ok: true } : { ok: false, reason: `lemonsqueezy_http_${res.status}` };
    } catch (e) {
      return { ok: false, reason: `lemonsqueezy_exception: ${errMsg(e)}` };
    }
  }
}

// ---- Mollie ------------------------------------------------------------------------------------------------------------

const MOLLIE = 'https://api.mollie.com/v2';
const OPEN = ['pending', 'open', 'authorized'];

/** `1 months` / `2 weeks` / `3 days`: the interval text Mollie subscriptions take (a year is `12 months`, its maximum). */
const mollieInterval = (r: {
  interval: 'day' | 'week' | 'month' | 'year';
  count: number;
}): string => (r.interval === 'year' ? '12 months' : `${r.count} ${r.interval}s`);

/**
 * Mollie (WD-PAYGW-019). One-time: the buyer returns to OUR url (token included), where the payment is re-read by the id we
 * stored (WaDesk's redirect carried no id and marked every return failed). Auto-renew: a customer and a first payment, then on
 * return a Mollie subscription. The notification posts only a payment id, so it is accepted when Mollie itself has that payment
 * and everything else is read from Mollie's answer.
 */
export class MollieDriver implements PaymentDriver {
  readonly slug = 'mollie';
  private readonly verified = new Map<string, Record<string, unknown>>();

  constructor(private readonly ctx: DriverContext) {}

  private get key(): string {
    return this.ctx.credentials.api_key ?? '';
  }
  private call(method: string, path: string, body?: unknown) {
    return this.ctx.http(`${MOLLIE}${path}`, {
      method,
      headers: { ...JSON_HEADERS, Authorization: bearer(this.key) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  private amount(order: DriverOrder) {
    return { currency: order.currency, value: order.amountMajor };
  }

  private async create(
    order: DriverOrder,
    urls: DriverUrls,
    extra: Record<string, unknown>,
    meta: Record<string, string>,
  ) {
    const res = await this.call('POST', '/payments', {
      amount: this.amount(order),
      description: `Order #${order.orderNumber}`,
      redirectUrl: urls.returnUrl,
      webhookUrl: urls.notifyUrl,
      metadata: { order_number: order.orderNumber, ...meta },
      ...extra,
    });
    const j = asRecord(res.json);
    const href = str(asRecord(asRecord(j._links).checkout).href);
    return href
      ? { ok: true as const, href, id: str(j.id) }
      : { ok: false as const, error: `${str(j.detail) ?? str(j.title) ?? 'create_failed'}` };
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('mollie', async () => {
      if (!this.key) return failed('mollie_api_key_missing');
      const r = await this.create(order, urls, {}, {});
      return r.ok
        ? pending({ redirectUrl: r.href, gatewayOrderId: r.id })
        : failed(`mollie: ${r.error}`);
    });
  }

  supportsRecurring(): boolean {
    return true;
  }

  createSubscription(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('mollie_subscription', async () => {
      if (!this.key) return failed('mollie_api_key_missing');
      const cust = asRecord(
        (
          await this.call('POST', '/customers', {
            name: order.customerName || `Order ${order.orderNumber}`,
            email: order.customerEmail ?? undefined,
          })
        ).json,
      );
      const customerId = str(cust.id);
      if (!customerId) return failed('mollie_customer_failed');
      const interval = mollieInterval(order.recurring ?? { interval: 'month', count: 1 });
      const r = await this.create(
        order,
        urls,
        { customerId, sequenceType: 'first' },
        { recurring: '1', interval },
      );
      return r.ok
        ? pending({
            redirectUrl: r.href,
            gatewayOrderId: r.id,
            payload: { gateway_customer_id: customerId },
          })
        : failed(`mollie_subscription: ${r.error}`);
    });
  }

  private async payment(id: string): Promise<Record<string, unknown>> {
    return asRecord((await this.call('GET', `/payments/${encodeURIComponent(id)}`)).json);
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    // Our own stored payment id, never one from the URL.
    const id = order.gatewayOrderId;
    if (!id) return pending();
    return guard('mollie_status', async () => {
      const p = await this.payment(id);
      const status = str(p.status) ?? '';
      if (OPEN.includes(status)) return pending({ gatewayOrderId: id });
      if (status === 'canceled') return failed(CANCELLED_BY_USER);
      if (status !== 'paid') return failed(`mollie_status: ${status}`);
      if (str(asRecord(p.metadata).order_number) !== order.orderNumber)
        return failed('mollie_reference_mismatch');
      const amt = asRecord(p.amount);
      if (!moneyMatches(order, amt.value, amt.currency)) return failed('mollie_amount_mismatch');
      return order.isRecurring ? this.subscribe(p, order) : paid(id, { payment: p });
    });
  }

  /** Mollie's first payment authorised the mandate; now the recurring schedule is created on that customer. */
  private async subscribe(p: Record<string, unknown>, order: DriverOrder): Promise<PaymentResult> {
    const id = str(p.id) ?? '';
    const customerId = str(p.customerId);
    if (!customerId) return paid(id, { payment: p });
    const interval = str(asRecord(p.metadata).interval) ?? '1 months';
    const res = await this.call(
      'POST',
      `/customers/${encodeURIComponent(customerId)}/subscriptions`,
      {
        amount: this.amount(order),
        interval,
        description: `Sub ${order.orderNumber}`,
        webhookUrl: this.ctx.webhookUrl,
        metadata: { order_number: order.orderNumber },
      },
    );
    const sub = asRecord(res.json);
    const subId = str(sub.id);
    // The first charge stands even if the schedule could not be created: the buyer is paid up for one cycle.
    if (!subId) return paid(id, { payment: p, recurring_setup: 'failed' });
    return paid(id, {
      payment: p,
      is_subscription: true,
      gateway_subscription_id: subId,
      gateway_customer_id: customerId,
      current_period_end: str(sub.nextPaymentDate) ?? null,
    });
  }

  /** No signature exists: a notification is accepted when Mollie itself returns that payment, which is then the only source. */
  async verifyWebhook(rawBody: Buffer): Promise<boolean> {
    const id = str(notificationFields(rawBody).id);
    if (!this.key || !id) return false;
    try {
      const p = await this.payment(id);
      if (str(p.id) !== id) return false;
      this.verified.set(id, p);
      return true;
    } catch {
      return false;
    }
  }

  parseSubscriptionWebhook(body: unknown): SubscriptionEvent | null {
    const id = str(asRecord(body).id);
    const p = id ? this.verified.get(id) : undefined;
    const subId = str(p?.subscriptionId);
    if (!p || !subId) return null; // a first or one-off payment follows the order path
    return {
      type: p.status === 'paid' ? 'renewed' : 'payment_failed',
      subscriptionId: subId,
      paymentId: id,
    };
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const id = str(asRecord(body).id);
    const p = id ? this.verified.get(id) : undefined;
    if (!p || p.status !== 'paid') return null;
    const meta = asRecord(p.metadata);
    // A recurring first payment is completed on the buyer's return, which also creates the subscription; finalising it here
    // would give a plan that never renews.
    if (meta.recurring === '1' && p.sequenceType === 'first') return null;
    const amt = asRecord(p.amount);
    const cur = str(amt.currency)?.toUpperCase();
    return {
      orderNumber: str(meta.order_number),
      gatewayOrderId: id,
      gatewayPaymentId: id,
      amountMinor: cur ? (minorOf(amt.value, cur) ?? undefined) : undefined,
      currency: cur,
      payload: { payment: p },
    };
  }

  async cancelSubscription(ref: SubscriptionRef): Promise<CancelResult> {
    if (!this.key || !ref.gatewayCustomerId)
      return { ok: false, reason: 'mollie_cancel_context_missing' };
    try {
      const res = await this.call(
        'DELETE',
        `/customers/${encodeURIComponent(ref.gatewayCustomerId)}/subscriptions/${encodeURIComponent(ref.gatewaySubscriptionId)}`,
      );
      return isOk(res) ? { ok: true } : { ok: false, reason: `mollie_http_${res.status}` };
    } catch (e) {
      return { ok: false, reason: `mollie_exception: ${errMsg(e)}` };
    }
  }
}
