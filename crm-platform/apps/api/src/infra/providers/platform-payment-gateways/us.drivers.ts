import { createHash, createHmac } from 'node:crypto';
import {
  CANCELLED_BY_USER,
  JSON_HEADERS,
  asRecord,
  basicAuth,
  bearer,
  failed,
  guard,
  header,
  hmacB64,
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

const live = (ctx: DriverContext): boolean => ctx.mode === 'live';
const safeId = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '');
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const toBig = (v: unknown): bigint | undefined => {
  try {
    return v === undefined || v === null || v === '' ? undefined : BigInt(String(v));
  } catch {
    return undefined;
  }
};

// ---- Square ------------------------------------------------------------------------------------------------------------

const SQUARE_VERSION = '2024-01-18';

/** Square's notification signature: base64 HMAC-SHA256 of `notificationUrl + rawBody`. Exported for the fixture tests. */
export const squareSignature = (url: string, rawBody: Buffer | string, key: string): string =>
  hmacB64('sha256', key, `${url}${rawBody.toString()}`);

/**
 * Square (TW-PAYGW-021 rules 1 and 2): a payment link for one-time purchases, verified by reading the Square order (state,
 * our reference, amount); catalogue plan + customer + subscription for auto-renew, where the first invoice Square emails is what
 * activates the plan (its `invoice.payment_made` notification).
 */
export class SquareDriver implements PaymentDriver {
  readonly slug = 'square';

  constructor(private readonly ctx: DriverContext) {}

  private get base(): string {
    return live(this.ctx)
      ? 'https://connect.squareup.com/v2'
      : 'https://connect.squareupsandbox.com/v2';
  }
  private get headers(): Record<string, string> {
    return {
      ...JSON_HEADERS,
      Authorization: bearer(this.ctx.credentials.access_token ?? ''),
      'Square-Version': SQUARE_VERSION,
    };
  }
  private call(method: string, path: string, body?: unknown) {
    return this.ctx.http(`${this.base}${path}`, {
      method,
      headers: this.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('square', async () => {
      const { access_token: token, location_id: location } = this.ctx.credentials;
      if (!token || !location) return failed('square_credentials_missing');
      const res = await this.call('POST', '/online-checkout/payment-links', {
        idempotency_key: `sq_${safeId(order.orderNumber)}_${Date.now()}`,
        order: {
          location_id: location,
          line_items: [
            {
              name: `Order #${order.orderNumber}`,
              quantity: '1',
              base_price_money: { amount: Number(order.amountMinor), currency: order.currency },
            },
          ],
          reference_id: order.orderNumber,
        },
        checkout_options: {
          redirect_url: urls.returnUrl,
          ask_for_shipping_address: false,
          allow_tipping: false,
        },
      });
      const link = asRecord(asRecord(res.json).payment_link);
      return str(link.url)
        ? pending({ redirectUrl: str(link.url), gatewayOrderId: str(link.order_id) })
        : failed(
            `square: ${str(asRecord(asArray(asRecord(res.json).errors)[0]).detail) ?? 'create_failed'}`,
          );
    });
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const orderId = params.orderId ?? params.order_id;
    // A subscription checkout (or a bare return) carries no order id: the notification is what confirms it.
    if (!orderId) return pending();
    if (order.gatewayOrderId && order.gatewayOrderId !== orderId)
      return failed('square_order_mismatch');
    return guard('square_callback', async () => {
      const res = await this.call('GET', `/orders/${encodeURIComponent(orderId)}`);
      const o = asRecord(asRecord(res.json).order);
      const state = str(o.state) ?? '';
      if (state !== 'COMPLETED') return failed(`square_state: ${state}`);
      if (str(o.reference_id) !== order.orderNumber) return failed('square_reference_mismatch');
      const total = asRecord(o.total_money);
      if (total.amount !== undefined && !minorEq(order, total.amount, total.currency))
        return failed('square_amount_mismatch');
      const tender = asRecord(asArray(o.tenders)[0]);
      return paid(str(tender.id) ?? orderId, { order: o });
    });
  }

  /** `x-square-hmacsha256-signature` over the exact notification URL (given by the operator in Square) and the raw body. */
  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    const key = this.ctx.credentials.webhook_signature_key ?? '';
    const sig = header(headers, 'x-square-hmacsha256-signature');
    const url = this.ctx.webhookUrl ?? '';
    return !!key && !!sig && !!url && safeEqual(squareSignature(url, rawBody, key), sig);
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const b = asRecord(body);
    if (b.type !== 'payment.created' && b.type !== 'payment.updated') return null;
    const payment = asRecord(asRecord(asRecord(b.data).object).payment);
    if (payment.status !== 'COMPLETED') return null;
    const money = asRecord(payment.amount_money);
    return {
      gatewayOrderId: str(payment.order_id),
      gatewayPaymentId: str(payment.id),
      amountMinor: toBig(money.amount),
      currency: str(money.currency)?.toUpperCase(),
      payload: { payment },
    };
  }

  supportsRecurring(): boolean {
    return true;
  }

  createSubscription(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('square_subscription', async () => {
      const { access_token: token, location_id: location } = this.ctx.credentials;
      if (!token || !location) return failed('square_credentials_missing');
      if (!order.customerEmail) return failed('square_customer_email_missing');
      const cadence = { day: 'DAILY', week: 'WEEKLY', year: 'ANNUAL', month: 'MONTHLY' }[
        order.recurring?.interval ?? 'month'
      ];
      const stamp = `${safeId(order.orderNumber)}_${Date.now()}`;
      const catalog = asRecord(
        (
          await this.call('POST', '/catalog/batch-upsert', {
            idempotency_key: `sqcat_${stamp}`,
            batches: [
              {
                objects: [
                  {
                    type: 'SUBSCRIPTION_PLAN',
                    id: '#plan',
                    subscription_plan_data: {
                      name: order.planName ?? order.description,
                      subscription_plan_variations: [
                        {
                          type: 'SUBSCRIPTION_PLAN_VARIATION',
                          id: '#variation',
                          subscription_plan_variation_data: {
                            name: `${cadence} plan`,
                            phases: [
                              {
                                cadence,
                                pricing: {
                                  type: 'STATIC',
                                  price_money: {
                                    amount: Number(order.amountMinor),
                                    currency: order.currency,
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          })
        ).json,
      );
      const variation = asArray(catalog.id_mappings)
        .map(asRecord)
        .find((m) => m.client_object_id === '#variation');
      const variationId = str(variation?.object_id);
      if (!variationId)
        return failed(
          `square_plan_variation_failed: ${str(asRecord(asArray(catalog.errors)[0]).detail) ?? 'unknown'}`,
        );
      const customer = asRecord(
        asRecord(
          (
            await this.call('POST', '/customers', {
              idempotency_key: `sqcust_${stamp}`,
              email_address: order.customerEmail,
              given_name: order.customerName || 'Customer',
              reference_id: order.orderNumber,
            })
          ).json,
        ).customer,
      );
      const customerId = str(customer.id);
      if (!customerId) return failed('square_customer_failed');
      const subRes = asRecord(
        (
          await this.call('POST', '/subscriptions', {
            idempotency_key: `sqsub_${stamp}`,
            location_id: location,
            plan_variation_id: variationId,
            customer_id: customerId,
          })
        ).json,
      );
      const sub = asRecord(subRes.subscription);
      const subId = str(sub.id);
      if (!subId)
        return failed(
          `square_subscription_failed: ${str(asRecord(asArray(subRes.errors)[0]).detail) ?? 'unknown'}`,
        );
      // Square emails the first invoice; paying it is what activates the plan. The buyer is sent back to wait for that.
      return pending({
        redirectUrl: urls.returnUrl,
        gatewayOrderId: subId,
        payload: {
          is_subscription: true,
          gateway_subscription_id: subId,
          gateway_customer_id: customerId,
          gateway_plan_id: variationId,
          current_period_end: str(sub.charged_through_date) ?? null,
        },
      });
    });
  }

  parseSubscriptionWebhook(body: unknown): SubscriptionEvent | null {
    const b = asRecord(body);
    const obj = asRecord(asRecord(b.data).object);
    if (b.type === 'invoice.payment_made') {
      const invoice = asRecord(obj.invoice);
      const subId = str(invoice.subscription_id);
      return subId
        ? { type: 'renewed', subscriptionId: subId, paymentId: str(invoice.id) ?? null }
        : null;
    }
    if (b.type === 'subscription.updated') {
      const sub = asRecord(obj.subscription);
      const status = (str(sub.status) ?? '').toUpperCase();
      if (status === 'CANCELED' || status === 'DEACTIVATED')
        return { type: 'canceled', subscriptionId: str(sub.id) ?? null };
    }
    return null;
  }

  async cancelSubscription(ref: SubscriptionRef): Promise<CancelResult> {
    if (!this.ctx.credentials.access_token)
      return { ok: false, reason: 'square_access_token_missing' };
    try {
      const res = await this.call(
        'POST',
        `/subscriptions/${encodeURIComponent(ref.gatewaySubscriptionId)}/cancel`,
        {},
      );
      return isOk(res) ? { ok: true } : { ok: false, reason: `square_http_${res.status}` };
    } catch (e) {
      return {
        ok: false,
        reason: `square_exception: ${e instanceof Error ? e.message : 'error'}`.slice(0, 200),
      };
    }
  }
}

/** A provider's amount in minor units (a number or numeric string) against the order. */
const minorEq = (o: DriverOrder, amount: unknown, currency: unknown): boolean =>
  toBig(amount) === o.amountMinor &&
  (currency === undefined || currency === null || String(currency).toUpperCase() === o.currency);

// ---- Braintree ---------------------------------------------------------------------------------------------------------

const xmlEsc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** First `<name>..</name>` of an XML text (the responses used here have no repeated or nested ambiguity worth a parser). */
const tag = (xml: string, name: string): string | undefined => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1]!.trim() : undefined;
};
const BT_PAID = ['authorized', 'submitted_for_settlement', 'settled', 'settling'];

/**
 * Braintree's webhook signature: `<publicKey>|<hmac-sha1 hex of bt_payload>`, keyed with the raw SHA-1 of the private key
 * (Braintree's own SDKs). Exported for the tests.
 */
export const braintreeSignature = (payload: string, privateKey: string): string =>
  createHmac('sha1', createHash('sha1').update(privateKey).digest()).update(payload).digest('hex');

/**
 * Braintree (TW-PAYGW-021 rules 3 and 4): the Drop-in widget in the browser produces a nonce which is posted to OUR return URL
 * (carrying the order's own token, so a nonce can only be spent on the order it was made for) and charged for the amount we
 * store. With a configured plan id an auto-renew checkout vaults the card and starts a subscription instead.
 */
export class BraintreeDriver implements PaymentDriver {
  readonly slug = 'braintree';

  constructor(private readonly ctx: DriverContext) {}

  private get c(): { merchant: string; pub: string; priv: string; plan: string } {
    const {
      merchant_id: merchant = '',
      public_key: pub = '',
      private_key: priv = '',
      plan_id: plan = '',
    } = this.ctx.credentials;
    return { merchant, pub, priv, plan };
  }
  private get base(): string {
    return live(this.ctx)
      ? 'https://api.braintreegateway.com:443/merchants'
      : 'https://api.sandbox.braintreegateway.com:443/merchants';
  }
  private call(method: string, path: string, xml = ''): Promise<string> {
    const { pub, priv, merchant } = this.c;
    return this.ctx
      .http(`${this.base}/${merchant}${path}`, {
        method,
        headers: {
          Authorization: basicAuth(pub, priv),
          'Content-Type': 'application/xml',
          Accept: 'application/xml',
          'X-ApiVersion': '6',
        },
        body: xml === '' ? undefined : xml,
      })
      .then((r) => r.text);
  }

  supportsRecurring(): boolean {
    return this.c.plan !== '';
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('braintree', async () => {
      const { merchant, pub, priv } = this.c;
      if (!merchant || !pub || !priv) return failed('braintree_credentials_missing');
      const body = await this.call(
        'POST',
        '/client_token',
        '<client-token><version>2</version></client-token>',
      );
      const clientToken = tag(body, 'value');
      if (!clientToken) return failed('braintree_client_token_failed');
      return pending({
        gatewayOrderId: order.orderNumber,
        clientAction: {
          provider: 'braintree',
          params: { clientToken, returnUrl: urls.returnUrl },
        },
      });
    });
  }

  createSubscription(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return this.initiate(order, urls);
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const nonce = params.payment_method_nonce;
    if (!nonce) return failed('missing_braintree_nonce');
    return guard('braintree_callback', () =>
      order.isRecurring && this.c.plan ? this.subscribe(nonce, order) : this.sale(nonce, order),
    );
  }

  private async sale(nonce: string, order: DriverOrder): Promise<PaymentResult> {
    const body = await this.call(
      'POST',
      '/transactions',
      `<transaction><type>sale</type><amount>${xmlEsc(order.amountMajor)}</amount><order-id>${xmlEsc(order.orderNumber)}</order-id>` +
        `<payment-method-nonce>${xmlEsc(nonce)}</payment-method-nonce><options><submit-for-settlement>true</submit-for-settlement></options></transaction>`,
    );
    const status = tag(body, 'status') ?? '';
    const id = tag(body, 'id') ?? '';
    if (!BT_PAID.includes(status))
      return failed(`braintree_status: ${status}. ${tag(body, 'message') ?? ''}`.trim());
    // The account's default currency applies (no per-currency merchant account is configured): a mismatch is refunded at once.
    const currency = tag(body, 'currency-iso-code');
    if (
      (currency && currency.toUpperCase() !== order.currency) ||
      !moneyMatches(order, tag(body, 'amount'))
    ) {
      await this.call('PUT', `/transactions/${encodeURIComponent(id)}/void`, ' ').catch(() => '');
      return failed('braintree_amount_or_currency_mismatch');
    }
    return paid(id, { status });
  }

  private async subscribe(nonce: string, order: DriverOrder): Promise<PaymentResult> {
    const customer = await this.call(
      'POST',
      '/customers',
      `<customer><credit-card><payment-method-nonce>${xmlEsc(nonce)}</payment-method-nonce><options><verify-card>false</verify-card></options></credit-card></customer>`,
    );
    const token = tag(customer, 'token');
    const customerId = /<customer>[\s\S]*?<id>([\s\S]*?)<\/id>/.exec(customer)?.[1]?.trim();
    if (!token) return failed('braintree_vault_failed');
    const sub = await this.call(
      'POST',
      '/subscriptions',
      `<subscription><payment-method-token>${xmlEsc(token)}</payment-method-token><plan-id>${xmlEsc(this.c.plan)}</plan-id>` +
        `<price>${xmlEsc(order.amountMajor)}</price></subscription>`,
    );
    const subId =
      /<subscription>[\s\S]*?<id>([\s\S]*?)<\/id>/.exec(sub)?.[1]?.trim() ?? tag(sub, 'id');
    const status = tag(sub, 'status') ?? '';
    if ((status === 'Active' || status === 'Pending') && subId) {
      return paid(subId, {
        is_subscription: true,
        gateway_subscription_id: subId,
        gateway_customer_id: customerId,
        status,
      });
    }
    return failed(`braintree_subscription_status: ${status}. ${tag(sub, 'message') ?? ''}`.trim());
  }

  private decode(rawOrBody: Buffer | Record<string, unknown>): { kind?: string; xml: string } {
    const f = Buffer.isBuffer(rawOrBody) ? notificationFields(rawOrBody) : rawOrBody;
    const payload = str(f.bt_payload);
    if (!payload) return { xml: '' };
    const xml = Buffer.from(payload, 'base64').toString('utf8');
    return { kind: tag(xml, 'kind'), xml };
  }

  /** `bt_signature` lists `publicKey|signature` pairs; ours is the one with our public key. */
  async verifyWebhook(rawBody: Buffer): Promise<boolean> {
    const { pub, priv } = this.c;
    const f = notificationFields(rawBody);
    const sig = str(f.bt_signature);
    const payload = str(f.bt_payload);
    if (!pub || !priv || !sig || !payload) return false;
    const mine = sig
      .split('&')
      .map((p) => p.split('|'))
      .find(([k]) => k === pub)?.[1];
    return !!mine && safeEqual(braintreeSignature(payload, priv), mine);
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const { kind, xml } = this.decode(asRecord(body));
    // Reference also treated a `disbursement` as a payment: that is a payout to the merchant, never money from a buyer.
    if (kind !== 'transaction_settled') return null;
    const cur = tag(xml, 'currency-iso-code')?.toUpperCase();
    return {
      orderNumber: tag(xml, 'order-id'),
      gatewayPaymentId: tag(xml, 'id'),
      amountMinor: cur ? (minorOf(tag(xml, 'amount'), cur) ?? undefined) : undefined,
      currency: cur,
      payload: { kind },
    };
  }

  parseSubscriptionWebhook(body: unknown): SubscriptionEvent | null {
    const { kind, xml } = this.decode(asRecord(body));
    const subId = /<subscription>[\s\S]*?<id>([\s\S]*?)<\/id>/.exec(xml)?.[1]?.trim();
    if (!subId) return null;
    switch (kind) {
      case 'subscription_charged_successfully': {
        const txn = /<transactions>[\s\S]*?<id>([\s\S]*?)<\/id>/.exec(xml)?.[1]?.trim();
        return { type: 'renewed', subscriptionId: subId, paymentId: txn ?? null };
      }
      case 'subscription_charged_unsuccessfully':
        return { type: 'payment_failed', subscriptionId: subId };
      case 'subscription_canceled':
      case 'subscription_expired':
        return { type: 'canceled', subscriptionId: subId };
      default:
        return null;
    }
  }

  async cancelSubscription(ref: SubscriptionRef): Promise<CancelResult> {
    try {
      const body = await this.call(
        'PUT',
        `/subscriptions/${encodeURIComponent(ref.gatewaySubscriptionId)}/cancel`,
        ' ',
      );
      return tag(body, 'status') === 'Canceled'
        ? { ok: true }
        : { ok: false, reason: 'braintree_cancel_failed' };
    } catch (e) {
      return {
        ok: false,
        reason: `braintree_exception: ${e instanceof Error ? e.message : 'error'}`.slice(0, 200),
      };
    }
  }
}

// ---- Authorize.Net -----------------------------------------------------------------------------------------------------

const ANET_OK = ['settledSuccessfully', 'capturedPendingSettlement', 'authorizedPendingCapture'];
const ANET_FAILED = ['voided', 'declined', 'expired', 'failedReview'];
const ANET_PAYMENT_EVENTS = [
  'net.authorize.payment.authcapture.created',
  'net.authorize.payment.capture.created',
  'net.authorize.payment.priorAuthCapture.created',
];

/**
 * Authorize.Net (TW-PAYGW-021 rules 5 to 7): the Accept Hosted page. A return counts only after `getTransactionDetails` says the
 * transaction is good, belongs to THIS order (invoice number) and has the right amount; when the lookup fails the order stays
 * pending (Reference trusted the query string at that point). Notifications are HMAC-SHA512 signed (required) and always re-read.
 */
export class AuthorizeNetDriver implements PaymentDriver {
  readonly slug = 'authorize_net';
  private readonly seen = new Map<string, { pay: WebhookPayment; subscription: string | null }>();

  constructor(private readonly ctx: DriverContext) {}

  private get api(): string {
    return live(this.ctx)
      ? 'https://api.authorize.net/xml/v1/request.api'
      : 'https://apitest.authorize.net/xml/v1/request.api';
  }
  private get auth(): { name: string; transactionKey: string } {
    return {
      name: this.ctx.credentials.api_login_id ?? '',
      transactionKey: this.ctx.credentials.transaction_key ?? '',
    };
  }

  private async request(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await this.ctx.http(this.api, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
    try {
      // The API prefixes its JSON with a byte-order mark.
      return asRecord(JSON.parse(res.text.replace(/^\uFEFF/, '')));
    } catch {
      return {};
    }
  }

  supportsRecurring(): boolean {
    return true;
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('authorize_net', async () => {
      if (!this.auth.name || !this.auth.transactionKey)
        return failed('authorize_net_credentials_missing');
      const j = await this.request({
        getHostedPaymentPageRequest: {
          merchantAuthentication: this.auth,
          transactionRequest: {
            transactionType: 'authCaptureTransaction',
            amount: order.amountMajor,
            order: { invoiceNumber: order.orderNumber, description: `Order #${order.orderNumber}` },
          },
          hostedPaymentSettings: {
            setting: [
              {
                settingName: 'hostedPaymentReturnOptions',
                settingValue: JSON.stringify({
                  showReceipt: false,
                  url: urls.returnUrl,
                  urlText: 'Return',
                  cancelUrl: `${urls.returnUrl}${urls.returnUrl.includes('?') ? '&' : '?'}cancelled=1`,
                }),
              },
              {
                settingName: 'hostedPaymentButtonOptions',
                settingValue: JSON.stringify({ text: 'Pay Now' }),
              },
            ],
          },
        },
      });
      const token = str(j.token);
      if (!token)
        return failed(
          `authorize_net: ${str(asRecord(asArray(asRecord(j.messages).message)[0]).text) ?? 'token_failed'}`,
        );
      return pending({
        gatewayOrderId: order.orderNumber,
        formPost: {
          url: live(this.ctx)
            ? 'https://accept.authorize.net/payment/payment'
            : 'https://test.authorize.net/payment/payment',
          fields: { token },
        },
      });
    });
  }

  createSubscription(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return this.initiate(order, urls);
  }

  private async details(transId: string): Promise<Record<string, unknown> | null> {
    const j = await this.request({
      getTransactionDetailsRequest: { merchantAuthentication: this.auth, transId },
    });
    return asRecord(j.messages).resultCode === 'Ok' ? asRecord(j.transaction) : null;
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    if (params.cancelled) return failed(CANCELLED_BY_USER);
    const transId = params.transId ?? params.x_trans_id;
    // The hosted page's redirect carries no transaction data; the signed notification confirms the order.
    if (!transId) return pending();
    return guard('authorize_net_callback', async () => {
      const txn = await this.details(transId);
      if (!txn) return pending({ gatewayPaymentId: transId });
      const status = str(txn.transactionStatus) ?? '';
      if (ANET_FAILED.includes(status)) return failed(`authorize_net_status: ${status}`, { txn });
      if (!ANET_OK.includes(status)) return pending({ gatewayPaymentId: transId });
      if (str(asRecord(txn.order).invoiceNumber) !== order.orderNumber)
        return failed('authorize_net_reference_mismatch');
      if (!moneyMatches(order, txn.authAmount ?? txn.settleAmount))
        return failed('authorize_net_amount_mismatch');
      if (order.isRecurring) return this.arb(transId, order, txn);
      return paid(transId, { txn });
    });
  }

  /** TW-PAYGW-021 rule 7: vault the paid card and start the ARB subscription. The first charge stands even if this fails. */
  private async arb(
    transId: string,
    order: DriverOrder,
    txn: Record<string, unknown>,
  ): Promise<PaymentResult> {
    const profile = await this.request({
      createCustomerProfileFromTransactionRequest: { merchantAuthentication: this.auth, transId },
    });
    const profileId = str(profile.customerProfileId);
    const list = profile.customerPaymentProfileIdList;
    const paymentProfile = str(asArray(list)[0]) ?? str(asArray(asRecord(list).numericString)[0]);
    if (asRecord(profile.messages).resultCode !== 'Ok' || !profileId || !paymentProfile)
      return paid(transId, { txn, recurring_setup: 'no_profile' });
    const rec = order.recurring ?? { interval: 'month' as const, count: 1 };
    const count = Math.max(1, rec.count);
    const start = new Date();
    let length: number;
    let unit: 'months' | 'days';
    if (rec.interval === 'year') {
      [length, unit] = [12, 'months'];
      start.setUTCFullYear(start.getUTCFullYear() + count);
    } else if (rec.interval === 'week') {
      [length, unit] = [Math.min(365, 7 * count), 'days'];
      start.setUTCDate(start.getUTCDate() + 7 * count);
    } else if (rec.interval === 'day') {
      [length, unit] = [Math.min(365, count), 'days'];
      start.setUTCDate(start.getUTCDate() + count);
    } else {
      [length, unit] = [Math.min(12, count), 'months'];
      start.setUTCMonth(start.getUTCMonth() + count);
    }
    const arb = await this.request({
      ARBCreateSubscriptionRequest: {
        merchantAuthentication: this.auth,
        subscription: {
          name: `Order ${order.orderNumber}`,
          paymentSchedule: {
            interval: { length, unit },
            startDate: start.toISOString().slice(0, 10),
            totalOccurrences: 9999,
          },
          amount: order.amountMajor,
          profile: { customerProfileId: profileId, customerPaymentProfileId: paymentProfile },
        },
      },
    });
    const subId = str(arb.subscriptionId);
    if (asRecord(arb.messages).resultCode === 'Ok' && subId) {
      return paid(transId, {
        txn,
        is_subscription: true,
        gateway_subscription_id: subId,
        current_period_end: start.toISOString(),
      });
    }
    return paid(transId, { txn, recurring_setup: 'arb_failed' });
  }

  /** `X-ANET-Signature: sha512=<HEX>` = HMAC-SHA512 of the raw body keyed with the hex-decoded signature key. */
  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    const key = this.ctx.credentials.signature_key ?? '';
    const sig = header(headers, 'x-anet-signature')?.replace(/^sha512=/i, '');
    if (!key || !/^[0-9a-fA-F]+$/.test(key) || !sig) return false;
    const expected = createHmac('sha512', Buffer.from(key, 'hex')).update(rawBody).digest('hex');
    if (!safeEqual(expected.toUpperCase(), sig.toUpperCase())) return false;
    // Signed: now read what the notification is about from Authorize.Net itself, never from the body.
    const f = notificationFields(rawBody);
    const id = str(asRecord(f.payload).id);
    if (id && ANET_PAYMENT_EVENTS.includes(String(f.eventType))) {
      try {
        const txn = await this.details(id);
        if (txn && ANET_OK.includes(str(txn.transactionStatus) ?? '')) {
          this.seen.set(id, {
            pay: {
              orderNumber: str(asRecord(txn.order).invoiceNumber),
              gatewayPaymentId: id,
              amountMinor: minorOf(txn.authAmount ?? txn.settleAmount, 'USD') ?? undefined,
              payload: { txn },
            },
            subscription: str(asRecord(txn.subscription).id) ?? null,
          });
        }
      } catch {
        // acknowledged, never applied
      }
    }
    return true;
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const id = str(asRecord(asRecord(body).payload).id);
    return (id && this.seen.get(id)?.pay) || null;
  }

  parseSubscriptionWebhook(body: unknown): SubscriptionEvent | null {
    const b = asRecord(body);
    const event = String(b.eventType ?? '');
    const id = str(asRecord(b.payload).id) ?? '';
    if (ANET_PAYMENT_EVENTS.includes(event) && event !== 'net.authorize.payment.capture.created') {
      const sub = this.seen.get(id)?.subscription;
      return sub ? { type: 'renewed', subscriptionId: sub, paymentId: id } : null;
    }
    if (event.startsWith('net.authorize.customer.subscription.')) {
      if (/cancelled|expired|terminated/.test(event))
        return { type: 'canceled', subscriptionId: id };
      if (/failed|suspended/.test(event)) return { type: 'payment_failed', subscriptionId: id };
    }
    return null;
  }

  async cancelSubscription(ref: SubscriptionRef): Promise<CancelResult> {
    try {
      const j = await this.request({
        ARBCancelSubscriptionRequest: {
          merchantAuthentication: this.auth,
          subscriptionId: ref.gatewaySubscriptionId,
        },
      });
      return asRecord(j.messages).resultCode === 'Ok'
        ? { ok: true }
        : {
            ok: false,
            reason: `authorize_net_cancel: ${str(asRecord(asArray(asRecord(j.messages).message)[0]).text) ?? 'failed'}`,
          };
    } catch (e) {
      return {
        ok: false,
        reason: `authorize_net_exception: ${e instanceof Error ? e.message : 'error'}`.slice(
          0,
          200,
        ),
      };
    }
  }
}
