import {
  CANCELLED_BY_USER,
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
  minorOf,
  moneyMatches,
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

const PAYSTACK = 'https://api.paystack.co';
const FLW = 'https://api.flutterwave.com/v3';

/** Paystack (WD-PAYGW-020): hosted checkout, verified by reference. Amounts are minor units (kobo) and come from the exponent table. */
export class PaystackDriver implements PaymentDriver {
  readonly slug = 'paystack';

  constructor(private readonly ctx: DriverContext) {}

  private get key(): string {
    return this.ctx.credentials.secret_key ?? '';
  }

  private get headers(): Record<string, string> {
    return { ...JSON_HEADERS, Authorization: bearer(this.key) };
  }

  private async start(order: DriverOrder, urls: DriverUrls, plan?: string): Promise<PaymentResult> {
    if (!this.key) return failed('paystack_secret_key_missing');
    if (!order.customerEmail) return failed('paystack_customer_email_missing');
    // The reference embeds our order number so a return or notification can be matched; the timestamp keeps retries unique.
    const reference = `${order.orderNumber}_${Date.now()}`;
    const res = await this.ctx.http(`${PAYSTACK}/transaction/initialize`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        email: order.customerEmail,
        amount: Number(order.amountMinor),
        currency: order.currency,
        ...(plan ? { plan } : {}),
        reference,
        callback_url: urls.returnUrl,
        metadata: { order_number: order.orderNumber },
      }),
    });
    const j = asRecord(res.json);
    const d = asRecord(j.data);
    if (j.status === true && str(d.authorization_url)) {
      return pending({
        redirectUrl: str(d.authorization_url),
        gatewayOrderId: str(d.reference) ?? reference,
        payload: plan ? { gateway_plan_id: plan } : undefined,
      });
    }
    return failed(`paystack: ${str(j.message) ?? 'init_failed'}`);
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('paystack', () => this.start(order, urls));
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const reference = params.reference ?? params.trxref;
    if (!reference) return failed('missing_paystack_reference');
    if (!reference.startsWith(`${order.orderNumber}_`))
      return failed('paystack_reference_mismatch');
    return guard('paystack', async () => {
      const res = await this.ctx.http(
        `${PAYSTACK}/transaction/verify/${encodeURIComponent(reference)}`,
        {
          method: 'GET',
          headers: this.headers,
        },
      );
      const j = asRecord(res.json);
      const d = asRecord(j.data);
      if (j.status !== true || d.status !== 'success')
        return failed(`paystack_status: ${str(d.status) ?? 'unknown'}`);
      if (!minorMatches(order, d.amount, d.currency)) return failed('paystack_amount_mismatch');
      return paid(String(d.id ?? reference), { transaction: d });
    });
  }

  /** `x-paystack-signature` = HMAC-SHA512 of the raw body with the secret key. WaDesk accepted anything when no key was saved. */
  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    const sig = header(headers, 'x-paystack-signature');
    return !!this.key && !!sig && safeEqual(hmacHex('sha512', this.key, rawBody), sig);
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const evt = asRecord(body);
    const d = asRecord(evt.data);
    if (evt.event !== 'charge.success' || d.status !== 'success') return null;
    return {
      orderNumber: str(asRecord(d.metadata).order_number),
      gatewayOrderId: str(d.reference),
      gatewayPaymentId: String(d.id ?? d.reference ?? ''),
      amountMinor: typeof d.amount === 'number' ? BigInt(d.amount) : undefined,
      currency: str(d.currency)?.toUpperCase(),
      payload: { transaction: d },
    };
  }

  supportsRecurring(): boolean {
    return true;
  }

  createSubscription(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('paystack_subscription', async () => {
      if (!this.key) return failed('paystack_secret_key_missing');
      const interval = { day: 'daily', week: 'weekly', year: 'annually', month: 'monthly' }[
        order.recurring?.interval ?? 'month'
      ];
      const planRes = await this.ctx.http(`${PAYSTACK}/plan`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          name: order.planName ?? order.description,
          interval,
          amount: Number(order.amountMinor),
          currency: order.currency,
        }),
      });
      const pj = asRecord(planRes.json);
      const code = str(asRecord(pj.data).plan_code);
      if (pj.status !== true || !code)
        return failed(`paystack_plan: ${str(pj.message) ?? 'create_failed'}`);
      return this.start(order, urls, code);
    });
  }

  parseSubscriptionWebhook(body: unknown): SubscriptionEvent | null {
    const evt = asRecord(body);
    const d = asRecord(evt.data);
    const planCode = str(asRecord(d.plan).plan_code) ?? null;
    switch (evt.event) {
      case 'subscription.create':
        return {
          type: 'created',
          subscriptionId: str(d.subscription_code) ?? null,
          gatewayPlanId: planCode,
          periodEnd: str(d.next_payment_date) ?? null,
        };
      case 'invoice.update':
      case 'invoice.create': {
        const sub = str(asRecord(d.subscription).subscription_code);
        if (!sub) return null;
        const ok = d.status === 'success' || d.paid === true;
        return {
          type: ok ? 'renewed' : 'payment_failed',
          subscriptionId: sub,
          gatewayPlanId: planCode,
          paymentId: str(asRecord(d.transaction).reference),
          periodEnd: str(asRecord(d.subscription).next_payment_date) ?? null,
        };
      }
      case 'invoice.payment_failed': {
        const sub = str(asRecord(d.subscription).subscription_code);
        return sub ? { type: 'payment_failed', subscriptionId: sub } : null;
      }
      case 'subscription.disable':
      case 'subscription.not_renew':
        return { type: 'canceled', subscriptionId: str(d.subscription_code) ?? null };
      default:
        return null;
    }
  }

  async cancelSubscription(ref: SubscriptionRef): Promise<CancelResult> {
    if (!this.key) return { ok: false, reason: 'paystack_secret_key_missing' };
    try {
      const code = encodeURIComponent(ref.gatewaySubscriptionId);
      const get = await this.ctx.http(`${PAYSTACK}/subscription/${code}`, {
        method: 'GET',
        headers: this.headers,
      });
      const token = str(asRecord(asRecord(get.json).data).email_token);
      if (!token) return { ok: false, reason: 'paystack_email_token_missing' };
      const res = await this.ctx.http(`${PAYSTACK}/subscription/disable`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ code: ref.gatewaySubscriptionId, token }),
      });
      return asRecord(res.json).status === true
        ? { ok: true }
        : { ok: false, reason: 'paystack_cancel_failed' };
    } catch (e) {
      return { ok: false, reason: `paystack_cancel_exception: ${brief(e)}` };
    }
  }
}

/** Flutterwave standard checkout (WD-PAYGW-020). Amounts are decimals in major units. */
export class FlutterwaveDriver implements PaymentDriver {
  readonly slug = 'flutterwave';

  constructor(private readonly ctx: DriverContext) {}

  private get key(): string {
    return this.ctx.credentials.secret_key ?? '';
  }

  private get headers(): Record<string, string> {
    return { ...JSON_HEADERS, Authorization: bearer(this.key) };
  }

  private async start(
    order: DriverOrder,
    urls: DriverUrls,
    planId?: string,
  ): Promise<PaymentResult> {
    if (!this.key) return failed('flutterwave_secret_key_missing');
    if (!order.customerEmail) return failed('flutterwave_customer_email_missing');
    const txRef = `${planId ? 'FLWSUB' : 'FLW'}_${order.orderNumber}_${Date.now()}`;
    const res = await this.ctx.http(`${FLW}/payments`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        tx_ref: txRef,
        amount: Number(order.amountMajor),
        currency: order.currency,
        redirect_url: urls.returnUrl,
        ...(planId
          ? { payment_plan: planId }
          : { payment_options: 'card,mobilemoney,ussd,banktransfer' }),
        customer: { email: order.customerEmail, name: order.customerName ?? 'Customer' },
        customizations: { description: `Order #${order.orderNumber}` },
        meta: { order_number: order.orderNumber },
      }),
    });
    const j = asRecord(res.json);
    const link = str(asRecord(j.data).link);
    if (j.status === 'success' && link) {
      return pending({
        redirectUrl: link,
        gatewayOrderId: txRef,
        payload: planId ? { gateway_plan_id: planId, gateway_subscription_id: planId } : undefined,
      });
    }
    let reason = (str(j.message) ?? '').trim();
    if (!reason && res.status === 401)
      reason =
        'Authorization failed: the Secret Key is wrong (use the FLWSECK- secret, not the public key).';
    if (!reason && !res.json)
      reason = `Flutterwave blocked the request (HTTP ${res.status}); check the key and that this server can reach api.flutterwave.com.`;
    return failed(`flutterwave: ${reason || `create_failed (HTTP ${res.status})`}`);
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('flutterwave', () => this.start(order, urls));
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    if (params.status === 'cancelled') return failed(CANCELLED_BY_USER);
    const id = params.transaction_id;
    const txRef = params.tx_ref;
    if (!id && !txRef) return failed('missing_flutterwave_tx');
    if (txRef && !txRef.includes(`_${order.orderNumber}_`))
      return failed('flutterwave_reference_mismatch');
    return guard('flutterwave', async () => {
      const url = id
        ? `${FLW}/transactions/${encodeURIComponent(id)}/verify`
        : `${FLW}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef!)}`;
      const res = await this.ctx.http(url, { method: 'GET', headers: this.headers });
      const j = asRecord(res.json);
      const d = asRecord(j.data);
      if (j.status !== 'success' || d.status !== 'successful')
        return failed(`flutterwave_status: ${str(d.status) ?? 'unknown'}`);
      // The verified record must be OUR order: a successful transaction of another order proves nothing here.
      if (!String(d.tx_ref ?? '').includes(`_${order.orderNumber}_`))
        return failed('flutterwave_reference_mismatch');
      if (!moneyMatches(order, d.amount, d.currency)) return failed('flutterwave_amount_mismatch');
      return paid(String(d.id ?? id ?? txRef), { transaction: d });
    });
  }

  /** `verif-hash` must equal the secret hash set in the dashboard. WaDesk accepted anything when none was saved. */
  async verifyWebhook(_raw: Buffer, headers: Record<string, string | undefined>): Promise<boolean> {
    const hash = this.ctx.credentials.secret_hash;
    const got = header(headers, 'verif-hash');
    return !!hash && !!got && safeEqual(hash, got);
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const evt = asRecord(body);
    const d = asRecord(evt.data);
    if (evt.event !== 'charge.completed' || d.status !== 'successful') return null;
    const ref = str(d.tx_ref);
    return {
      orderNumber: str(asRecord(d.meta).order_number),
      gatewayOrderId: ref,
      gatewayPaymentId: String(d.id ?? ''),
      amountMinor: minorOf(d.amount, str(d.currency)?.toUpperCase() ?? 'USD') ?? undefined,
      currency: str(d.currency)?.toUpperCase(),
      payload: { transaction: d },
    };
  }

  supportsRecurring(): boolean {
    return true;
  }

  createSubscription(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('flutterwave_subscription', async () => {
      if (!this.key) return failed('flutterwave_secret_key_missing');
      const interval = { day: 'daily', week: 'weekly', year: 'yearly', month: 'monthly' }[
        order.recurring?.interval ?? 'month'
      ];
      const planRes = await this.ctx.http(`${FLW}/payment-plans`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          name: order.planName ?? order.description,
          amount: Number(order.amountMajor),
          interval,
          currency: order.currency,
        }),
      });
      const pj = asRecord(planRes.json);
      const planId = pj.status === 'success' ? String(asRecord(pj.data).id ?? '') : '';
      if (!planId) return failed(`flutterwave_plan: ${str(pj.message) ?? 'create_failed'}`);
      return this.start(order, urls, planId);
    });
  }

  parseSubscriptionWebhook(body: unknown): SubscriptionEvent | null {
    const evt = asRecord(body);
    const d = asRecord(evt.data);
    if (evt.event === 'charge.completed') {
      const plan = d.payment_plan ? String(d.payment_plan) : null;
      if (!plan) return null;
      return {
        type: d.status === 'successful' ? 'renewed' : 'payment_failed',
        subscriptionId: plan,
        gatewayPlanId: plan,
        paymentId: String(d.id ?? ''),
        orderNumber: str(asRecord(d.meta).order_number) ?? null,
      };
    }
    if (evt.event === 'subscription.cancelled') {
      const plan = asRecord(d.plan).id ?? d.plan_id;
      return plan
        ? { type: 'canceled', subscriptionId: String(plan), gatewayPlanId: String(plan) }
        : null;
    }
    return null;
  }

  async cancelSubscription(ref: SubscriptionRef): Promise<CancelResult> {
    if (!this.key) return { ok: false, reason: 'flutterwave_secret_key_missing' };
    try {
      const plan = ref.gatewayPlanId ?? ref.gatewaySubscriptionId;
      const list = await this.ctx.http(`${FLW}/subscriptions?plan=${encodeURIComponent(plan)}`, {
        method: 'GET',
        headers: this.headers,
      });
      const data = asRecord(list.json).data;
      const id = Array.isArray(data) ? asRecord(data[0]).id : undefined;
      if (!id) return { ok: false, reason: 'flutterwave_subscription_not_found' };
      const res = await this.ctx.http(`${FLW}/subscriptions/${String(id)}/cancel`, {
        method: 'PUT',
        headers: this.headers,
      });
      return asRecord(res.json).status === 'success' && isOk(res)
        ? { ok: true }
        : { ok: false, reason: 'flutterwave_cancel_failed' };
    } catch (e) {
      return { ok: false, reason: `flutterwave_cancel_exception: ${brief(e)}` };
    }
  }
}
