import {
  CANCELLED_BY_USER,
  JSON_HEADERS,
  asRecord,
  basicAuth,
  bearer,
  failed,
  guard,
  hashHex,
  header,
  isOk,
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
const id32 = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '');
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Order number out of an external id of the form `<ORDER>_<unix>` (Xendit); our own order numbers contain no underscore. */
const orderOfExternal = (ext: string): string => ext.slice(0, ext.lastIndexOf('_'));

// ---- Midtrans ----------------------------------------------------------------------------------------------------------

/** Midtrans (WD-PAYGW-023 rule 1): Snap redirect, verified through the Core status API; webhook signed with sha512. IDR only. */
export class MidtransDriver implements PaymentDriver {
  readonly slug = 'midtrans';

  constructor(private readonly ctx: DriverContext) {}

  private get key(): string {
    return this.ctx.credentials.server_key ?? '';
  }
  private get snapHost(): string {
    return live(this.ctx) ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
  }
  private get core(): string {
    return live(this.ctx) ? 'https://api.midtrans.com/v2' : 'https://api.sandbox.midtrans.com/v2';
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('midtrans', async () => {
      if (!this.key) return failed('midtrans_server_key_missing');
      if (!order.customerEmail) return failed('midtrans_customer_email_missing');
      const orderId = `MID_${id32(order.orderNumber)}_${nowSec()}`;
      const res = await this.ctx.http(`${this.snapHost}/snap/v1/transactions`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, Authorization: basicAuth(this.key, '') },
        body: JSON.stringify({
          transaction_details: {
            order_id: orderId,
            // Whole rupiah. The exponent table already makes IDR a whole number; the rounding only guards a misconfigured
            // currency whitelist.
            gross_amount: Math.round(Number(order.amountMajor)),
          },
          customer_details: {
            first_name: order.customerName ?? 'Customer',
            email: order.customerEmail,
          },
          callbacks: { finish: withQuery(urls.returnUrl, { order_id: orderId }) },
        }),
      });
      const j = asRecord(res.json);
      const token = str(j.token);
      // The hosted Snap page works for every Snap response, so WaDesk's inline `snap.pay` script is not needed.
      const url =
        str(j.redirect_url) ??
        (token ? `${this.snapHost}/snap/v2/vtweb/${encodeURIComponent(token)}` : undefined);
      if (!url) return failed(`midtrans: ${str(asArray(j.error_messages)[0]) ?? 'create_failed'}`);
      return pending({ redirectUrl: url, gatewayOrderId: orderId });
    });
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const orderId = params.order_id;
    if (!orderId) return failed('missing_midtrans_order_id');
    if (order.gatewayOrderId && order.gatewayOrderId !== orderId)
      return failed('midtrans_order_mismatch');
    return guard('midtrans_callback', async () => {
      const res = await this.ctx.http(`${this.core}/${encodeURIComponent(orderId)}/status`, {
        method: 'GET',
        headers: { ...JSON_HEADERS, Authorization: basicAuth(this.key, '') },
      });
      const j = asRecord(res.json);
      const status = str(j.transaction_status) ?? '';
      const fraud = str(j.fraud_status) ?? 'accept';
      if (status === 'settlement' || (status === 'capture' && fraud === 'accept')) {
        if (!moneyMatches(order, j.gross_amount, j.currency ?? order.currency))
          return failed('midtrans_amount_mismatch');
        return paid(str(j.transaction_id) ?? orderId, { status: j });
      }
      return status === 'pending'
        ? pending({ gatewayOrderId: orderId })
        : failed(`midtrans_status: ${status}`);
    });
  }

  /** `signature_key` = sha512(order_id + status_code + gross_amount + server_key), carried in the payload itself. */
  async verifyWebhook(rawBody: Buffer): Promise<boolean> {
    const f = notificationFields(rawBody);
    const sig = str(f.signature_key);
    if (!this.key || !sig) return false;
    const expected = hashHex(
      'sha512',
      `${String(f.order_id ?? '')}${String(f.status_code ?? '')}${String(f.gross_amount ?? '')}${this.key}`,
    );
    return safeEqual(expected, sig);
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const f = asRecord(body);
    const status = str(f.transaction_status) ?? '';
    const fraud = str(f.fraud_status) ?? 'accept';
    if (!(status === 'settlement' || (status === 'capture' && fraud === 'accept'))) return null;
    return {
      gatewayOrderId: str(f.order_id),
      gatewayPaymentId: str(f.transaction_id) ?? str(f.order_id),
      amountMinor: minorOf(f.gross_amount, str(f.currency) ?? 'IDR') ?? undefined,
      currency: str(f.currency)?.toUpperCase() ?? 'IDR',
      payload: { notification: f },
    };
  }
}

// ---- Duitku ------------------------------------------------------------------------------------------------------------

/** Duitku (WD-PAYGW-023 rule 2): invoice page, md5-signed notification that finalises by merchantOrderId. IDR only. */
export class DuitkuDriver implements PaymentDriver {
  readonly slug = 'duitku';

  constructor(
    private readonly ctx: DriverContext,
    private readonly clock: () => number = Date.now,
  ) {}

  private get code(): string {
    return (this.ctx.credentials.merchant_code ?? '').trim();
  }
  private get key(): string {
    return this.ctx.credentials.api_key ?? '';
  }
  private get base(): string {
    return live(this.ctx)
      ? 'https://api-prod.duitku.com/api/merchant'
      : 'https://api-sandbox.duitku.com/api/merchant';
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('duitku', async () => {
      if (!this.code || !this.key) return failed('duitku_credentials_missing');
      const amount = Math.round(Number(order.amountMajor));
      if (amount < 1) return failed('duitku_invalid_amount');
      const merchantOrderId = `DTK${id32(order.orderNumber)}-${String(Math.floor(this.clock() / 1000)).slice(-6)}`;
      const timestamp = String(this.clock());
      const res = await this.ctx.http(`${this.base}/createInvoice`, {
        method: 'POST',
        headers: {
          ...JSON_HEADERS,
          'x-duitku-signature': hashHex('sha256', `${this.code}${timestamp}${this.key}`),
          'x-duitku-timestamp': timestamp,
          'x-duitku-merchantcode': this.code,
        },
        body: JSON.stringify({
          merchantCode: this.code,
          paymentAmount: amount,
          merchantOrderId,
          productDetails: `Order ${order.orderNumber}`,
          email: order.customerEmail || 'customer@example.com',
          customerVaName: order.customerName || 'Customer',
          callbackUrl: urls.notifyUrl,
          returnUrl: withQuery(urls.returnUrl, { merchantOrderId }),
          expiryPeriod: 60,
        }),
      });
      const j = asRecord(res.json);
      if (String(j.statusCode ?? '') === '00' && str(j.paymentUrl)) {
        return pending({ redirectUrl: str(j.paymentUrl), gatewayOrderId: merchantOrderId });
      }
      return failed(`duitku: ${str(j.statusMessage) ?? str(j.Message) ?? 'create_failed'}`);
    });
  }

  private status(merchantOrderId: string, order: DriverOrder): Promise<PaymentResult> {
    return guard('duitku_status', async () => {
      const res = await this.ctx.http(`${this.base}/transactionStatus`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          merchantCode: this.code,
          merchantOrderId,
          signature: hashHex('md5', `${this.code}${merchantOrderId}${this.key}`),
        }),
      });
      const j = asRecord(res.json);
      const code = String(j.statusCode ?? '');
      if (code === '00') {
        if (!moneyMatches(order, j.amount)) return failed('duitku_amount_mismatch');
        return paid(str(j.reference) ?? merchantOrderId, { status: j });
      }
      return code === '01'
        ? pending({ gatewayOrderId: merchantOrderId })
        : failed(`duitku_status: ${str(j.statusMessage) ?? code}`);
    });
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const id = params.merchantOrderId;
    if (!id) return failed('duitku_missing_order_id');
    if (order.gatewayOrderId && order.gatewayOrderId !== id) return failed('duitku_order_mismatch');
    return this.status(id, order);
  }

  /** `signature` = md5(merchantCode + amount + merchantOrderId + apiKey). */
  async verifyWebhook(rawBody: Buffer): Promise<boolean> {
    const f = notificationFields(rawBody);
    const sig = str(f.signature);
    const id = str(f.merchantOrderId);
    if (!this.code || !this.key || !sig || !id) return false;
    return safeEqual(hashHex('md5', `${this.code}${String(f.amount ?? '')}${id}${this.key}`), sig);
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const f = asRecord(body);
    if (String(f.resultCode ?? '') !== '00') return null;
    return {
      gatewayOrderId: str(f.merchantOrderId),
      gatewayPaymentId: str(f.reference) ?? str(f.merchantOrderId),
      amountMinor: minorOf(f.amount, 'IDR') ?? undefined,
      currency: 'IDR',
      payload: { notification: f },
    };
  }
}

// ---- Xendit ------------------------------------------------------------------------------------------------------------

const XENDIT = 'https://api.xendit.co';

/** Xendit (WD-PAYGW-023 rule 3): invoice page; the return looks the invoice up by external id; webhook uses a static token. */
export class XenditDriver implements PaymentDriver {
  readonly slug = 'xendit';

  constructor(private readonly ctx: DriverContext) {}

  private get key(): string {
    return this.ctx.credentials.secret_key ?? '';
  }
  private get headers(): Record<string, string> {
    return { ...JSON_HEADERS, Authorization: basicAuth(this.key, '') };
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('xendit', async () => {
      if (!this.key) return failed('xendit_secret_key_missing');
      if (!order.customerEmail) return failed('xendit_customer_email_missing');
      const ext = `${order.orderNumber}_${nowSec()}`;
      const res = await this.ctx.http(`${XENDIT}/v2/invoices`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          external_id: ext,
          amount: Number(order.amountMajor),
          currency: order.currency,
          description: `Order #${order.orderNumber}`,
          payer_email: order.customerEmail,
          success_redirect_url: withQuery(urls.returnUrl, { status: 'success', xendit_ext: ext }),
          failure_redirect_url: withQuery(urls.returnUrl, { status: 'failed' }),
        }),
      });
      const j = asRecord(res.json);
      return str(j.invoice_url)
        ? pending({ redirectUrl: str(j.invoice_url), gatewayOrderId: str(j.id) ?? ext })
        : failed(`xendit: ${str(j.message) ?? 'create_failed'}`);
    });
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    if (params.status === 'failed') return failed('xendit_failed');
    const ext = params.xendit_ext;
    // Without the external id there is nothing to check; the webhook will confirm (left pending, not failed).
    if (!ext) return pending();
    if (!ext.startsWith(`${order.orderNumber}_`)) return failed('xendit_reference_mismatch');
    return guard('xendit_callback', async () => {
      const res = await this.ctx.http(`${XENDIT}/v2/invoices?${urlForm({ external_id: ext })}`, {
        method: 'GET',
        headers: this.headers,
      });
      const first = Array.isArray(res.json) ? asRecord(res.json[0]) : asRecord(res.json);
      const status = (str(first.status) ?? '').toUpperCase();
      if (status !== 'PAID' && status !== 'SETTLED') return pending();
      if (!moneyMatches(order, first.paid_amount ?? first.amount, first.currency))
        return failed('xendit_amount_mismatch');
      return paid(str(first.id), { invoice: first });
    });
  }

  /** The dashboard's static callback token, compared in constant time. No token saved means nothing is accepted. */
  async verifyWebhook(_raw: Buffer, headers: Record<string, string | undefined>): Promise<boolean> {
    const token = this.ctx.credentials.webhook_token ?? '';
    const sent = header(headers, 'x-callback-token');
    return token !== '' && !!sent && safeEqual(token, sent);
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const f = asRecord(body);
    const status = (str(f.status) ?? '').toUpperCase();
    if (status !== 'PAID' && status !== 'SETTLED') return null;
    const ext = str(f.external_id);
    return {
      orderNumber: ext ? orderOfExternal(ext) : undefined,
      gatewayOrderId: str(f.id),
      gatewayPaymentId: str(f.id),
      amountMinor: minorOf(f.paid_amount ?? f.amount, str(f.currency) ?? 'IDR') ?? undefined,
      currency: str(f.currency)?.toUpperCase(),
      payload: { notification: f },
    };
  }
}

// ---- Tap ---------------------------------------------------------------------------------------------------------------

const TAP = 'https://api.tap.company/v2';

/**
 * Tap (WD-PAYGW-023 rule 4): charge page. Return AND notification both re-fetch the charge by id, so neither trusts what was
 * posted. The notification body is used only for the charge id; the money and the order reference come from Tap's own answer.
 */
export class TapDriver implements PaymentDriver {
  readonly slug = 'tap';
  private readonly verified = new Map<string, WebhookPayment>();

  constructor(private readonly ctx: DriverContext) {}

  private get key(): string {
    return this.ctx.credentials.secret_key ?? '';
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('tap', async () => {
      if (!this.key) return failed('tap_secret_key_missing');
      if (!order.customerEmail) return failed('tap_customer_email_missing');
      const res = await this.ctx.http(`${TAP}/charges`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, Authorization: bearer(this.key) },
        body: JSON.stringify({
          amount: Number(order.amountMajor),
          currency: order.currency,
          customer: { first_name: order.customerName ?? 'Customer', email: order.customerEmail },
          source: { id: 'src_all' },
          redirect: { url: urls.returnUrl },
          post: { url: urls.notifyUrl },
          reference: { transaction: order.orderNumber, order: order.orderNumber },
          description: `Order #${order.orderNumber}`,
          metadata: { order_number: order.orderNumber },
        }),
      });
      const j = asRecord(res.json);
      const url = str(asRecord(j.transaction).url);
      return url
        ? pending({ redirectUrl: url, gatewayOrderId: str(j.id) })
        : failed(`tap: ${str(asRecord(asArray(j.errors)[0]).description) ?? 'create_failed'}`);
    });
  }

  private async charge(id: string): Promise<Record<string, unknown> | null> {
    const res = await this.ctx.http(`${TAP}/charges/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { ...JSON_HEADERS, Authorization: bearer(this.key) },
    });
    return isOk(res) ? asRecord(res.json) : null;
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const id = params.tap_id ?? params.id;
    if (!id) return failed('missing_tap_charge_id');
    return guard('tap_callback', async () => {
      const c = await this.charge(id);
      if (!c) return failed('tap_charge_unavailable');
      if (c.status !== 'CAPTURED') return failed(`tap_status: ${str(c.status) ?? 'unknown'}`);
      if (str(asRecord(c.reference).order) !== order.orderNumber)
        return failed('tap_reference_mismatch');
      if (!moneyMatches(order, c.amount, c.currency)) return failed('tap_amount_mismatch');
      return paid(str(c.id) ?? id, { charge: c });
    });
  }

  /** There is no signature: a notification is accepted only when Tap itself reports that charge as captured. */
  async verifyWebhook(rawBody: Buffer): Promise<boolean> {
    const id = str(notificationFields(rawBody).id);
    if (!this.key || !id) return false;
    try {
      const c = await this.charge(id);
      if (!c || c.status !== 'CAPTURED') return false;
      this.verified.set(id, {
        orderNumber: str(asRecord(c.reference).order),
        gatewayOrderId: id,
        gatewayPaymentId: id,
        amountMinor: minorOf(c.amount, String(c.currency ?? '')) ?? undefined,
        currency: str(c.currency)?.toUpperCase(),
        payload: { charge: c },
      });
      return true;
    } catch {
      return false;
    }
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const id = str(asRecord(body).id);
    return (id && this.verified.get(id)) || null;
  }
}

// ---- HyperPay ----------------------------------------------------------------------------------------------------------

const SUCCESS_CODE = /^(000\.000\.|000\.100\.1)/;
const PENDING_CODE = /^000\.[36]/;

/** HyperPay (WD-PAYGW-023 rule 5): a prepared checkout the browser renders as a payment widget; the result is fetched by path. */
export class HyperPayDriver implements PaymentDriver {
  readonly slug = 'hyperpay';

  constructor(private readonly ctx: DriverContext) {}

  private get base(): string {
    return live(this.ctx) ? 'https://eu-prod.oppwa.com' : 'https://eu-test.oppwa.com';
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('hyperpay', async () => {
      const { access_token: token, entity_id: entity } = this.ctx.credentials;
      if (!token || !entity) return failed('hyperpay_credentials_missing');
      const res = await this.ctx.http(`${this.base}/v1/checkouts`, {
        method: 'POST',
        headers: {
          Authorization: bearer(token),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: urlForm({
          entityId: entity,
          amount: order.amountMajor,
          currency: order.currency,
          paymentType: 'DB',
          merchantTransactionId: order.orderNumber,
        }),
      });
      const j = asRecord(res.json);
      const checkoutId = str(j.id);
      if (!checkoutId)
        return failed(`hyperpay: ${str(asRecord(j.result).description) ?? 'checkout_failed'}`);
      return pending({
        gatewayOrderId: checkoutId,
        clientAction: {
          provider: 'hyperpay',
          params: {
            scriptUrl: `${this.base}/v1/paymentWidgets.js?checkoutId=${encodeURIComponent(checkoutId)}`,
            returnUrl: urls.returnUrl,
            brands: 'VISA MASTER AMEX MADA',
          },
        },
      });
    });
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const path = params.resourcePath;
    if (!path) return failed('missing_hyperpay_resource_path');
    // The path is only ever `/v1/checkouts/<our checkout id>/payment`: anything else is not ours and is never requested.
    const expected = `/v1/checkouts/${order.gatewayOrderId ?? ''}/payment`;
    if (!order.gatewayOrderId || path !== expected) return failed('hyperpay_resource_mismatch');
    return guard('hyperpay_callback', async () => {
      const { access_token: token, entity_id: entity } = this.ctx.credentials;
      const res = await this.ctx.http(`${this.base}${path}?${urlForm({ entityId: entity })}`, {
        method: 'GET',
        headers: { Authorization: bearer(token ?? ''), Accept: 'application/json' },
      });
      const j = asRecord(res.json);
      const code = str(asRecord(j.result).code) ?? '';
      if (SUCCESS_CODE.test(code)) {
        if (str(j.merchantTransactionId) !== order.orderNumber)
          return failed('hyperpay_reference_mismatch');
        if (!moneyMatches(order, j.amount, j.currency)) return failed('hyperpay_amount_mismatch');
        return paid(str(j.id), { payment: j });
      }
      if (PENDING_CODE.test(code)) return pending({ gatewayPaymentId: str(j.id) });
      return failed(`hyperpay: ${str(asRecord(j.result).description) ?? `code: ${code}`}`);
    });
  }

  /** HyperPay sends no server notification to this integration. */
  async verifyWebhook(): Promise<boolean> {
    return false;
  }
  parseWebhook(): WebhookPayment | null {
    return null;
  }
}

// ---- SSLCommerz --------------------------------------------------------------------------------------------------------

/** SSLCommerz IPN signature: md5 of the fields named by `verify_key`, sorted, plus md5 of the store password. Exported for tests. */
export function sslcommerzSign(fields: Record<string, string>, storePassword: string): string {
  const keys = (fields.verify_key ?? '').split(',').filter(Boolean).sort();
  const text = keys
    .filter((k) => k in fields)
    .map((k) => `${k}=${fields[k]}&`)
    .join('');
  return hashHex('md5', `${text}store_passwd=${hashHex('md5', storePassword)}`);
}

/** SSLCommerz (WD-PAYGW-023 rule 6): hosted page; the return is validated through the validator API, the IPN by `verify_sign`. */
export class SslcommerzDriver implements PaymentDriver {
  readonly slug = 'sslcommerz';

  constructor(private readonly ctx: DriverContext) {}

  private get base(): string {
    return live(this.ctx) ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com';
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('sslcommerz', async () => {
      const { store_id: id, store_password: pass } = this.ctx.credentials;
      if (!id || !pass) return failed('sslcommerz_credentials_missing');
      if (!order.customerEmail) return failed('sslcommerz_customer_email_missing');
      const tran = `SSL_${id32(order.orderNumber)}_${nowSec()}`;
      const res = await this.ctx.http(`${this.base}/gwprocess/v4/api.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: urlForm({
          store_id: id,
          store_passwd: pass,
          total_amount: order.amountMajor,
          currency: order.currency,
          tran_id: tran,
          success_url: urls.returnUrl,
          fail_url: withQuery(urls.returnUrl, { status: 'failed' }),
          cancel_url: withQuery(urls.returnUrl, { status: 'cancelled' }),
          ipn_url: urls.notifyUrl,
          cus_name: order.customerName ?? 'Customer',
          cus_email: order.customerEmail,
          // WaDesk sent placeholders; there is no phone or street address to send.
          cus_phone: '0000000000',
          cus_add1: 'N/A',
          cus_city: 'N/A',
          cus_country: 'Bangladesh',
          shipping_method: 'NO',
          product_name: `Order #${order.orderNumber}`,
          product_category: 'Subscription',
          product_profile: 'non-physical-goods',
          value_a: order.orderNumber,
        }),
      });
      const j = asRecord(res.json);
      return j.status === 'SUCCESS' && str(j.GatewayPageURL)
        ? pending({ redirectUrl: str(j.GatewayPageURL), gatewayOrderId: tran })
        : failed(`sslcommerz: ${str(j.failedreason) ?? 'init_failed'}`);
    });
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    if (params.status === 'cancelled') return failed(CANCELLED_BY_USER);
    if (params.status === 'failed') return failed('sslcommerz_failed');
    const valId = params.val_id;
    if (!valId) return failed('missing_sslcommerz_val_id');
    return guard('sslcommerz_callback', async () => {
      const { store_id: id, store_password: pass } = this.ctx.credentials;
      const res = await this.ctx.http(
        `${this.base}/validator/api/validationserverAPI.php?${urlForm({
          val_id: valId,
          store_id: id,
          store_passwd: pass,
          format: 'json',
        })}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
      );
      const j = asRecord(res.json);
      const status = str(j.status) ?? '';
      if (status !== 'VALID' && status !== 'VALIDATED')
        return failed(`sslcommerz_validation: ${status}`);
      if (order.gatewayOrderId && str(j.tran_id) !== order.gatewayOrderId)
        return failed('sslcommerz_transaction_mismatch');
      if (!moneyMatches(order, j.currency_amount ?? j.amount, j.currency_type))
        return failed('sslcommerz_amount_mismatch');
      return paid(valId, { validation: j });
    });
  }

  async verifyWebhook(rawBody: Buffer): Promise<boolean> {
    const f = notificationFields(rawBody) as Record<string, string>;
    const pass = this.ctx.credentials.store_password ?? '';
    if (!pass || !f.verify_sign || !f.verify_key) return false;
    return safeEqual(sslcommerzSign(f, pass), f.verify_sign);
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const f = asRecord(body);
    const status = str(f.status);
    if (status !== 'VALID' && status !== 'VALIDATED') return null;
    return {
      orderNumber: str(f.value_a),
      gatewayOrderId: str(f.tran_id),
      gatewayPaymentId: str(f.val_id) ?? str(f.tran_id),
      amountMinor:
        minorOf(f.currency_amount ?? f.amount, str(f.currency_type) ?? 'BDT') ?? undefined,
      currency: (str(f.currency_type) ?? 'BDT').toUpperCase(),
      payload: { notification: f },
    };
  }
}
