import { createHash, randomInt } from 'node:crypto';
import {
  CANCELLED_BY_USER,
  JSON_HEADERS,
  asRecord,
  bearer,
  failed,
  guard,
  hashHex,
  header,
  hmacB64,
  hmacHex,
  minorOf,
  moneyMatches,
  notificationFields,
  paid,
  pending,
  safeEqual,
  str,
  urlForm,
  withQuery,
  type DriverContext,
  type DriverOrder,
  type DriverUrls,
  type PaymentDriver,
  type PaymentResult,
  type WebhookPayment,
} from './payment-driver';

const live = (ctx: DriverContext): boolean => ctx.mode === 'live';
const nowSec = (): number => Math.floor(Date.now() / 1000);
const safeId = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '');

// ---- iyzico ------------------------------------------------------------------------------------------------------------

type PkiValue = string | number | PkiValue[] | { [k: string]: PkiValue };

const pkiPairs = (data: { [k: string]: PkiValue }): string =>
  Object.entries(data)
    .map(([k, v]) => `${k}=${pkiValue(v)}`)
    .join(', ');

function pkiValue(v: PkiValue): string {
  if (Array.isArray(v)) {
    return `[${v.map((i) => (typeof i === 'object' ? `[${pkiPairs(i as { [k: string]: PkiValue })}]` : String(i))).join(', ')}]`;
  }
  if (typeof v === 'object') return `[${pkiPairs(v)}]`;
  return String(v);
}

/** iyzico's "PKI string": the request fields in order, nested objects and lists in brackets. Exported for the fixture tests. */
export const iyzicoPki = (data: { [k: string]: PkiValue }): string => `[${pkiPairs(data)}]`;

/** iyzico (WD-PAYGW-024 rule 1): checkout form page, verified by the form's token through the detail call. */
export class IyzicoDriver implements PaymentDriver {
  readonly slug = 'iyzico';

  constructor(private readonly ctx: DriverContext) {}

  private get base(): string {
    return live(this.ctx) ? 'https://api.iyzipay.com' : 'https://sandbox-api.iyzipay.com';
  }

  private auth(body: { [k: string]: PkiValue }): Record<string, string> {
    const { api_key: key = '', secret_key: secret = '' } = this.ctx.credentials;
    const rnd = `${Date.now()}${randomInt(1, 999999)}`;
    const hash = createHash('sha1')
      .update(`${key}${rnd}${secret}${iyzicoPki(body)}`)
      .digest('base64');
    return { ...JSON_HEADERS, Authorization: `IYZWS ${key}:${hash}`, 'x-iyzi-rnd': rnd };
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('iyzico', async () => {
      if (!this.ctx.credentials.api_key || !this.ctx.credentials.secret_key)
        return failed('iyzico_credentials_missing');
      if (!order.customerEmail) return failed('iyzico_customer_email_missing');
      const name = order.customerName ?? 'Customer';
      const address = { contactName: name, city: 'N/A', country: 'N/A', address: 'N/A' };
      const body: { [k: string]: PkiValue } = {
        locale: 'en',
        conversationId: `iyz_${order.orderNumber}`,
        price: order.amountMajor,
        paidPrice: order.amountMajor,
        currency: order.currency,
        basketId: order.orderNumber,
        paymentGroup: 'PRODUCT',
        callbackUrl: urls.returnUrl,
        enabledInstallments: [1],
        buyer: {
          id: order.orderNumber,
          name,
          surname: 'User',
          email: order.customerEmail,
          // WaDesk sent the same placeholders; iyzico wants a national id and address we do not collect.
          identityNumber: '11111111111',
          registrationAddress: 'N/A',
          city: 'N/A',
          country: 'N/A',
          ip: '127.0.0.1',
        },
        shippingAddress: address,
        billingAddress: address,
        basketItems: [
          {
            id: `ITEM_${order.orderNumber}`,
            name: `Order #${order.orderNumber}`,
            category1: 'Subscription',
            itemType: 'VIRTUAL',
            price: order.amountMajor,
          },
        ],
      };
      const res = await this.ctx.http(
        `${this.base}/payment/iyzipos/checkoutform/initialize/auth/ecom`,
        { method: 'POST', headers: this.auth(body), body: JSON.stringify(body) },
      );
      const j = asRecord(res.json);
      return j.status === 'success' && str(j.paymentPageUrl)
        ? pending({ redirectUrl: str(j.paymentPageUrl), gatewayOrderId: str(j.token) })
        : failed(`iyzico: ${str(j.errorMessage) ?? 'init_failed'}`);
    });
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const token = params.token;
    if (!token) return failed('missing_iyzico_token');
    if (order.gatewayOrderId && order.gatewayOrderId !== token)
      return failed('iyzico_token_mismatch');
    return guard('iyzico_callback', async () => {
      const body = { locale: 'en', token };
      const res = await this.ctx.http(
        `${this.base}/payment/iyzipos/checkoutform/auth/ecom/detail`,
        { method: 'POST', headers: this.auth(body), body: JSON.stringify(body) },
      );
      const j = asRecord(res.json);
      if (j.status !== 'success' || j.paymentStatus !== 'SUCCESS')
        return failed(
          `iyzico: ${str(j.errorMessage) ?? `status: ${str(j.paymentStatus) ?? 'unknown'}`}`,
        );
      if (str(j.basketId) !== order.orderNumber) return failed('iyzico_reference_mismatch');
      if (!moneyMatches(order, j.paidPrice ?? j.price, j.currency))
        return failed('iyzico_amount_mismatch');
      return paid(str(j.paymentId) ?? token, { detail: j });
    });
  }

  /** iyzico sends no server notification to this integration; the buyer's return carries the token that is checked. */
  async verifyWebhook(): Promise<boolean> {
    return false;
  }
  parseWebhook(): WebhookPayment | null {
    return null;
  }
}

// ---- PayTR -------------------------------------------------------------------------------------------------------------

/** PayTR's notification hash: base64 HMAC-SHA256(merchant_oid + salt + status + total_amount, key). Exported for the tests. */
export const paytrNotificationHash = (
  f: { merchant_oid: string; status: string; total_amount: string },
  key: string,
  salt: string,
): string => hmacB64('sha256', key, `${f.merchant_oid}${salt}${f.status}${f.total_amount}`);

/**
 * PayTR (WD-PAYGW-024 rule 2): the secure frame page. The buyer's redirect proves nothing, so a return asks PayTR's order
 * inquiry; the signed server notification finalises it too and must be answered with the plain body `OK` (the controller does).
 */
export class PaytrDriver implements PaymentDriver {
  readonly slug = 'paytr';

  constructor(private readonly ctx: DriverContext) {}

  private get c(): { id: string; key: string; salt: string } {
    const {
      merchant_id: id = '',
      merchant_key: key = '',
      merchant_salt: salt = '',
    } = this.ctx.credentials;
    return { id, key, salt };
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('paytr', async () => {
      const { id, key, salt } = this.c;
      if (!id || !key || !salt) return failed('paytr_credentials_missing');
      if (!order.customerEmail) return failed('paytr_customer_email_missing');
      const oid = `PAYTR_${safeId(order.orderNumber)}_${nowSec()}`;
      const amount = String(order.amountMinor);
      const test = live(this.ctx) ? '0' : '1';
      const basket = Buffer.from(
        JSON.stringify([[`Order #${order.orderNumber}`, amount, 1]]),
      ).toString('base64');
      // PayTR checks the buyer's address; the API has no field for "unknown", so the documented placeholder is used.
      const ip = '127.0.0.1';
      const hashStr = `${id}${ip}${oid}${order.customerEmail}${amount}${basket}10${order.currency === 'TRY' ? 'TL' : order.currency}${test}`;
      const token = hmacB64('sha256', key, `${hashStr}${salt}`);
      const res = await this.ctx.http('https://www.paytr.com/odeme/api/get-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: urlForm({
          merchant_id: id,
          user_ip: ip,
          merchant_oid: oid,
          email: order.customerEmail,
          payment_amount: amount,
          paytr_token: token,
          user_basket: basket,
          debug_on: test,
          no_installment: '1',
          max_installment: '0',
          user_name: order.customerName ?? 'Customer',
          user_address: 'N/A',
          user_phone: '0000000000',
          merchant_ok_url: withQuery(urls.returnUrl, { status: 'success' }),
          merchant_fail_url: withQuery(urls.returnUrl, { status: 'failed' }),
          timeout_limit: '30',
          currency: order.currency === 'TRY' ? 'TL' : order.currency,
          test_mode: test,
        }),
      });
      const j = asRecord(res.json);
      const t = str(j.token);
      return j.status === 'success' && t
        ? pending({
            // The same page WaDesk put in an iframe, opened as the page itself.
            redirectUrl: `https://www.paytr.com/odeme/guvenli/${encodeURIComponent(t)}`,
            gatewayOrderId: oid,
          })
        : failed(`paytr: ${str(j.reason) ?? 'token_failed'}`);
    });
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    if (params.status === 'failed') return failed('paytr_failed');
    const oid = order.gatewayOrderId;
    if (!oid) return pending();
    return guard('paytr_callback', async () => {
      const { id, key, salt } = this.c;
      const res = await this.ctx.http('https://www.paytr.com/odeme/durum-sorgu', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: urlForm({
          merchant_id: id,
          merchant_oid: oid,
          paytr_token: hmacB64('sha256', key, `${id}${oid}${salt}`),
        }),
      });
      const j = asRecord(res.json);
      // Not paid yet (or not found): leave it pending; the signed notification finalises it.
      if (j.status !== 'success') return pending();
      if (!moneyMatches(order, Number(j.payment_amount) / 100))
        return failed('paytr_amount_mismatch');
      return paid(oid, { inquiry: j });
    });
  }

  async verifyWebhook(rawBody: Buffer): Promise<boolean> {
    const f = notificationFields(rawBody) as Record<string, string>;
    const { key, salt } = this.c;
    if (!key || !salt || !f.hash || !f.merchant_oid) return false;
    return safeEqual(
      paytrNotificationHash(
        {
          merchant_oid: f.merchant_oid,
          status: f.status ?? '',
          total_amount: f.total_amount ?? '',
        },
        key,
        salt,
      ),
      f.hash,
    );
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const f = asRecord(body);
    if (f.status !== 'success') return null;
    return {
      gatewayOrderId: str(f.merchant_oid),
      gatewayPaymentId: str(f.merchant_oid),
      // total_amount can include instalment commission; payment_amount is the price we asked for.
      amountMinor: toBig(f.payment_amount ?? f.total_amount),
      currency: undefined,
      payload: { notification: f },
    };
  }
}

const toBig = (v: unknown): bigint | undefined => {
  try {
    return v === undefined || v === null || v === '' ? undefined : BigInt(String(v));
  } catch {
    return undefined;
  }
};

// ---- Fondy -------------------------------------------------------------------------------------------------------------

/** Fondy's signature: sha1 of the payment key and every non-empty field, sorted by name, joined with `|`. Exported for tests. */
export function fondySign(fields: Record<string, unknown>, paymentKey: string): string {
  const values = Object.keys(fields)
    .filter((k) => k !== 'signature' && k !== 'response_signature_string')
    .filter((k) => fields[k] !== '' && fields[k] !== null && fields[k] !== undefined)
    .sort()
    .map((k) => String(fields[k]));
  return hashHex('sha1', [paymentKey, ...values].join('|'));
}

/** Fondy (WD-PAYGW-024 rule 3): checkout page; the signed return and the signed server callback both finalise. */
export class FondyDriver implements PaymentDriver {
  readonly slug = 'fondy';

  constructor(private readonly ctx: DriverContext) {}

  private get key(): string {
    return this.ctx.credentials.payment_key ?? '';
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('fondy', async () => {
      const merchant = this.ctx.credentials.merchant_id ?? '';
      if (!merchant || !this.key) return failed('fondy_credentials_missing');
      const orderId = `FONDY_${safeId(order.orderNumber)}_${nowSec()}`;
      const req: Record<string, unknown> = {
        order_id: orderId,
        merchant_id: merchant,
        order_desc: `Order #${order.orderNumber}`,
        amount: Number(order.amountMinor),
        currency: order.currency,
        response_url: urls.returnUrl,
        server_callback_url: urls.notifyUrl,
      };
      req.signature = fondySign(req, this.key);
      const res = await this.ctx.http('https://pay.fondy.eu/api/checkout/url/', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ request: req }),
      });
      const resp = asRecord(asRecord(res.json).response);
      return resp.response_status === 'success' && str(resp.checkout_url)
        ? pending({ redirectUrl: str(resp.checkout_url), gatewayOrderId: orderId })
        : failed(`fondy: ${str(resp.error_message) ?? 'create_failed'}`);
    });
  }

  private check(f: Record<string, unknown>): boolean {
    const sig = str(f.signature);
    return !!this.key && !!sig && safeEqual(fondySign(f, this.key), sig);
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    if (!this.check(params)) return failed('fondy_signature_invalid');
    if (order.gatewayOrderId && params.order_id !== order.gatewayOrderId)
      return failed('fondy_order_mismatch');
    if (params.order_status !== 'approved')
      return failed(`fondy_status: ${params.order_status ?? ''}`);
    if (!moneyMatchesMinor(order, params.amount, params.currency))
      return failed('fondy_amount_mismatch');
    return paid(params.payment_id || params.order_id, { response: params });
  }

  async verifyWebhook(rawBody: Buffer): Promise<boolean> {
    return this.check(notificationFields(rawBody));
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const f = asRecord(body);
    if (f.order_status !== 'approved') return null;
    return {
      gatewayOrderId: str(f.order_id),
      gatewayPaymentId: str(f.payment_id) ?? str(f.order_id),
      amountMinor: toBig(f.amount),
      currency: str(f.currency)?.toUpperCase(),
      payload: { notification: f },
    };
  }
}

/** Amount in minor units as the provider echoes it (a string or number), against the order. */
const moneyMatchesMinor = (o: DriverOrder, amount: unknown, currency: unknown): boolean =>
  toBig(amount) === o.amountMinor &&
  (currency === undefined || String(currency).toUpperCase() === o.currency);

// ---- Skrill ------------------------------------------------------------------------------------------------------------

/** Skrill's status-URL signature: upper md5 over merchant, transaction, upper md5 of the secret word, amounts and status. */
export const skrillSignature = (
  f: {
    merchant: string;
    transaction_id: string;
    mb_amount: string;
    mb_currency: string;
    status: string;
  },
  secretWord: string,
): string =>
  hashHex(
    'md5',
    `${f.merchant}${f.transaction_id}${hashHex('md5', secretWord).toUpperCase()}${f.mb_amount}${f.mb_currency}${f.status}`,
  ).toUpperCase();

/**
 * Skrill (WD-PAYGW-024 rule 4): an auto-posted form. The buyer's return proves nothing (it stays pending); the signed status
 * URL is the only confirmation, and it is matched by our transaction id. The money check uses `mb_amount`, the amount Skrill
 * credited and signed; a notification in another currency than the order cannot be proven and is left for an operator.
 */
export class SkrillDriver implements PaymentDriver {
  readonly slug = 'skrill';

  constructor(private readonly ctx: DriverContext) {}

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    const merchant = this.ctx.credentials.merchant_id ?? '';
    if (!merchant) return Promise.resolve(failed('skrill_merchant_id_missing'));
    const txn = `${order.orderNumber}_${nowSec()}`;
    return Promise.resolve(
      pending({
        gatewayOrderId: txn,
        formPost: {
          url: 'https://pay.skrill.com',
          fields: {
            pay_to_email: merchant,
            transaction_id: txn,
            return_url: withQuery(urls.returnUrl, { status: 'success' }),
            cancel_url: withQuery(urls.returnUrl, { status: 'cancelled' }),
            status_url: urls.notifyUrl,
            language: 'EN',
            amount: order.amountMajor,
            currency: order.currency,
            detail1_description: 'Order Number',
            detail1_text: order.orderNumber,
            merchant_fields: 'order_number',
            order_number: order.orderNumber,
          },
        },
      }),
    );
  }

  async confirmReturn(params: Record<string, string>): Promise<PaymentResult> {
    if (params.status === 'cancelled') return failed(CANCELLED_BY_USER);
    return pending();
  }

  async verifyWebhook(rawBody: Buffer): Promise<boolean> {
    const f = notificationFields(rawBody) as Record<string, string>;
    const { merchant_id: merchant = '', secret_word: secret = '' } = this.ctx.credentials;
    if (!merchant || !secret || !f.md5sig || !f.transaction_id) return false;
    const expected = skrillSignature(
      {
        merchant: f.merchant_id ?? merchant,
        transaction_id: f.transaction_id,
        mb_amount: f.mb_amount ?? '',
        mb_currency: f.mb_currency ?? '',
        status: f.status ?? '',
      },
      secret,
    );
    return safeEqual(expected, f.md5sig.toUpperCase());
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const f = asRecord(body);
    if (String(f.status) !== '2') return null;
    const cur = str(f.mb_currency)?.toUpperCase();
    return {
      orderNumber: str(f.order_number),
      gatewayOrderId: str(f.transaction_id),
      gatewayPaymentId: str(f.mb_transaction_id) ?? str(f.transaction_id),
      // Only a signed amount in the order's currency is comparable; otherwise report none and let the receiver refuse.
      amountMinor:
        cur && f.mb_amount !== undefined ? (minorOf(f.mb_amount, cur) ?? undefined) : undefined,
      currency: cur,
      payload: { notification: f },
    };
  }
}

// ---- 2Checkout ---------------------------------------------------------------------------------------------------------

const lenPrefixed = (v: string): string => `${Buffer.byteLength(v)}${v}`;

/** 2Checkout (WD-PAYGW-024 rule 5): a signed Buy Link; the return and the IPN are both checked, never trusted. */
export class TwocheckoutDriver implements PaymentDriver {
  readonly slug = 'twocheckout';

  constructor(
    private readonly ctx: DriverContext,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private stamp(d: Date): string {
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    const { merchant_code: code = '', buy_link_secret: secret = '' } = this.ctx.credentials;
    if (!code || !secret) return Promise.resolve(failed('twocheckout_credentials_missing'));
    const now = this.clock();
    const nowS = this.stamp(now);
    const signature = hmacHex(
      'sha256',
      secret,
      [code, nowS, order.amountMajor, order.currency, order.orderNumber].map(lenPrefixed).join(''),
    );
    const params = new URLSearchParams({
      merchant: code,
      dynamic: '1',
      'order-ext-ref': order.orderNumber,
      'item-ext-ref': `ORDER_${order.orderNumber}`,
      prod: `Order #${order.orderNumber}`,
      price: order.amountMajor,
      qty: '1',
      type: 'PRODUCT',
      currency: order.currency,
      'return-url': urls.returnUrl,
      'return-type': 'redirect',
      expiration: this.stamp(new Date(now.getTime() + 3_600_000)),
      'order-date': nowS,
      signature,
    });
    return Promise.resolve(
      pending({
        redirectUrl: `https://secure.2checkout.com/checkout/buy?${params.toString()}`,
        gatewayOrderId: order.orderNumber,
      }),
    );
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const ref = params.refno ?? params.REFNO;
    if (!ref) return failed('missing_twocheckout_refno');
    return guard('twocheckout', async () => {
      const { merchant_code: code = '', secret_key: secret = '' } = this.ctx.credentials;
      const nowS = this.stamp(this.clock());
      const hash = hmacHex('md5', secret, `${lenPrefixed(code)}${lenPrefixed(nowS)}`);
      const res = await this.ctx.http(
        `https://api.2checkout.com/rest/6.0/orders/${encodeURIComponent(ref)}/`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-Avangate-Authentication': `code="${code}" date="${nowS}" hash="${hash}"`,
          },
        },
      );
      const j = asRecord(res.json);
      const status = str(j.Status) ?? str(j.status) ?? '';
      if (status === 'PENDING') return pending({ gatewayPaymentId: ref });
      if (status !== 'COMPLETE' && status !== 'AUTHRECEIVED')
        return failed(`twocheckout_status: ${status}`);
      // The REST order carries the external reference we set on the Buy Link: it ties the refno to THIS order.
      if (str(j.ExternalReference) !== order.orderNumber)
        return failed('twocheckout_reference_mismatch');
      const cur = str(j.Currency);
      if (cur && cur.toUpperCase() !== order.currency)
        return failed('twocheckout_currency_mismatch');
      const amount = [j.NetPrice, j.GrossPrice].find(
        (a) => a !== undefined && moneyMatches(order, a),
      );
      if (amount === undefined && (j.NetPrice !== undefined || j.GrossPrice !== undefined))
        return failed('twocheckout_amount_mismatch');
      return paid(ref, { order: j });
    });
  }

  /** IPN: HMAC-MD5 over every field value in the order received (each length-prefixed), keyed with the secret key. */
  async verifyWebhook(rawBody: Buffer): Promise<boolean> {
    const secret = this.ctx.credentials.secret_key ?? '';
    const pairs = [...new URLSearchParams(rawBody.toString('utf8')).entries()];
    const received = pairs.find(([k]) => k === 'HASH')?.[1];
    if (!secret || !received) return false;
    const text = pairs
      .filter(([k]) => k !== 'HASH')
      .map(([, v]) => lenPrefixed(v))
      .join('');
    return safeEqual(hmacHex('md5', secret, text), received);
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const f = asRecord(body);
    const status = str(f.ORDERSTATUS);
    if (status !== 'COMPLETE' && status !== 'AUTHRECEIVED') return null;
    return {
      orderNumber: str(f.REFNOEXT),
      gatewayPaymentId: str(f.REFNO),
      payload: { ipn: f },
    };
  }
}

// ---- Coinbase Commerce -------------------------------------------------------------------------------------------------

const COINBASE = 'https://api.commerce.coinbase.com';

/**
 * Coinbase Commerce (WD-PAYGW-024 rule 6): a fixed-price charge. Crypto settles later, so the buyer's return leaves the order
 * pending (awaiting confirmation) and only the signed `charge:confirmed` notification marks it paid (WaDesk marked every
 * return failed and could never match the notification).
 */
export class CoinbaseDriver implements PaymentDriver {
  readonly slug = 'coinbase';

  constructor(private readonly ctx: DriverContext) {}

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('coinbase', async () => {
      const key = this.ctx.credentials.api_key ?? '';
      if (!key) return failed('coinbase_api_key_missing');
      const res = await this.ctx.http(`${COINBASE}/charges`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'X-CC-Api-Key': key, 'X-CC-Version': '2018-03-22' },
        body: JSON.stringify({
          name: `Order #${order.orderNumber}`,
          description: `Payment for Order #${order.orderNumber}`,
          pricing_type: 'fixed_price',
          local_price: { amount: order.amountMajor, currency: order.currency },
          metadata: { order_number: order.orderNumber },
          redirect_url: withQuery(urls.returnUrl, { status: 'success' }),
          cancel_url: withQuery(urls.returnUrl, { status: 'cancelled' }),
        }),
      });
      const d = asRecord(asRecord(res.json).data);
      return str(d.hosted_url)
        ? pending({ redirectUrl: str(d.hosted_url), gatewayOrderId: str(d.code) ?? str(d.id) })
        : failed(`coinbase: ${str(asRecord(asRecord(res.json).error).message) ?? 'create_failed'}`);
    });
  }

  async confirmReturn(params: Record<string, string>): Promise<PaymentResult> {
    return params.status === 'cancelled' ? failed(CANCELLED_BY_USER) : pending();
  }

  /** `X-CC-Webhook-Signature` = HMAC-SHA256 of the raw body with the shared secret. No secret saved: nothing is accepted. */
  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    const secret = this.ctx.credentials.webhook_secret ?? '';
    const sig = header(headers, 'x-cc-webhook-signature');
    return !!secret && !!sig && safeEqual(hmacHex('sha256', secret, rawBody), sig);
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const evt = asRecord(asRecord(body).event);
    if (evt.type !== 'charge:confirmed' && evt.type !== 'charge:completed') return null;
    const d = asRecord(evt.data);
    const local = asRecord(asRecord(d.pricing).local);
    const cur = str(local.currency)?.toUpperCase();
    return {
      orderNumber: str(asRecord(d.metadata).order_number),
      gatewayOrderId: str(d.code),
      gatewayPaymentId: str(d.id) ?? str(d.code),
      amountMinor: cur ? (minorOf(local.amount, cur) ?? undefined) : undefined,
      currency: cur,
      payload: { charge: d },
    };
  }
}

// ---- Mercado Pago ------------------------------------------------------------------------------------------------------

const MP = 'https://api.mercadopago.com';

/**
 * Mercado Pago (WD-PAYGW-024 rule 7): a preference page. WaDesk trusted `status=approved&payment_id` from the URL, which anyone
 * can type: here every return and every notification re-reads the payment from the API and checks reference, status, amount.
 */
export class MercadoPagoDriver implements PaymentDriver {
  readonly slug = 'mercadopago';
  private readonly verified = new Map<string, WebhookPayment>();

  constructor(private readonly ctx: DriverContext) {}

  private get token(): string {
    return this.ctx.credentials.access_token ?? '';
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('mercadopago', async () => {
      if (!this.token) return failed('mercadopago_access_token_missing');
      const res = await this.ctx.http(`${MP}/checkout/preferences`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, Authorization: bearer(this.token) },
        body: JSON.stringify({
          items: [
            {
              title: `Order #${order.orderNumber}`,
              quantity: 1,
              unit_price: Number(order.amountMajor),
              currency_id: order.currency,
            },
          ],
          back_urls: {
            success: withQuery(urls.returnUrl, { status: 'approved' }),
            failure: withQuery(urls.returnUrl, { status: 'rejected' }),
            pending: withQuery(urls.returnUrl, { status: 'pending' }),
          },
          auto_return: 'approved',
          external_reference: order.orderNumber,
          notification_url: urls.notifyUrl,
        }),
      });
      const j = asRecord(res.json);
      const url = str(live(this.ctx) ? j.init_point : j.sandbox_init_point);
      return url
        ? pending({ redirectUrl: url, gatewayOrderId: str(j.id) })
        : failed(`mercadopago: ${str(j.message) ?? 'create_failed'}`);
    });
  }

  private async payment(id: string): Promise<Record<string, unknown>> {
    const res = await this.ctx.http(`${MP}/v1/payments/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { ...JSON_HEADERS, Authorization: bearer(this.token) },
    });
    return asRecord(res.json);
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const status = params.status ?? params.collection_status ?? '';
    const id = params.payment_id ?? params.collection_id;
    if (status === 'rejected') return failed('mercadopago_status: rejected');
    if (!id) return pending();
    return guard('mercadopago_callback', async () => {
      const p = await this.payment(id);
      const s = str(p.status) ?? '';
      if (s !== 'approved') {
        return ['pending', 'in_process', 'authorized', 'in_mediation'].includes(s)
          ? pending({ gatewayPaymentId: id })
          : failed(`mercadopago_status: ${s}`);
      }
      if (str(p.external_reference) !== order.orderNumber)
        return failed('mercadopago_reference_mismatch');
      if (!moneyMatches(order, p.transaction_amount, p.currency_id))
        return failed('mercadopago_amount_mismatch');
      return paid(id, { payment: p });
    });
  }

  /**
   * `x-signature: ts=..,v1=..` = HMAC-SHA256 of `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (request-id part only when
   * the header is present). After the signature, the payment is read from the API and kept for `parseWebhook`.
   */
  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    const secret = this.ctx.credentials.webhook_secret ?? '';
    const sig = header(headers, 'x-signature');
    if (!secret || !sig || !this.token) return false;
    const kv = Object.fromEntries(
      sig.split(',').map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
      }),
    ) as Record<string, string>;
    const data = asRecord(notificationFields(rawBody).data);
    const dataId = String(data.id ?? '').toLowerCase();
    if (!kv.ts || !kv.v1 || !dataId) return false;
    const reqId = header(headers, 'x-request-id');
    const manifest = `id:${dataId};${reqId ? `request-id:${reqId};` : ''}ts:${kv.ts};`;
    if (!safeEqual(hmacHex('sha256', secret, manifest), kv.v1)) return false;
    try {
      const p = await this.payment(String(data.id));
      if (p.status === 'approved') {
        const cur = str(p.currency_id)?.toUpperCase();
        this.verified.set(String(data.id), {
          orderNumber: str(p.external_reference),
          gatewayPaymentId: String(data.id),
          amountMinor: cur ? (minorOf(p.transaction_amount, cur) ?? undefined) : undefined,
          currency: cur,
          payload: { payment: p },
        });
      }
    } catch {
      // an unreadable payment is acknowledged but never applied
    }
    return true;
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const b = asRecord(body);
    const type = str(b.type) ?? str(b.topic);
    const id = String(asRecord(b.data).id ?? b.id ?? '');
    return type === 'payment' && id ? (this.verified.get(id) ?? null) : null;
  }
}
