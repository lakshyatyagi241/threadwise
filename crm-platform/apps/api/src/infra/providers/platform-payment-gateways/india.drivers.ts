import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  CANCELLED_BY_USER,
  JSON_HEADERS,
  asRecord,
  failed,
  guard,
  hashHex,
  header,
  hmacB64,
  hmacHex,
  isOk,
  minorOf,
  moneyMatches,
  paid,
  parseForm,
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

const sandbox = (ctx: DriverContext): boolean => ctx.mode !== 'live';
const safeId = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '');

// ---- Paytm -------------------------------------------------------------------------------------------------------------

const PAYTM_IV = Buffer.from('@@@@&&&&####$$$$');
/** PHP pads or truncates the AES key to 16 bytes; Paytm merchant keys are 16 characters. */
const aesKey = (key: string): Buffer => {
  const b = Buffer.alloc(16);
  Buffer.from(key).copy(b, 0, 0, 16);
  return b;
};

/** Paytm's checksum: AES-128-CBC over sha256(payload|salt)+salt. Exported for the fixture tests. */
export function paytmChecksum(
  payload: string,
  key: string,
  salt = randomBytes(2).toString('hex'),
): string {
  const cipher = createCipheriv('aes-128-cbc', aesKey(key), PAYTM_IV);
  return Buffer.concat([
    cipher.update(`${hashHex('sha256', `${payload}|${salt}`)}${salt}`),
    cipher.final(),
  ]).toString('base64');
}

export function paytmVerify(
  params: Record<string, string>,
  key: string,
  checksum: string,
): boolean {
  try {
    const d = createDecipheriv('aes-128-cbc', aesKey(key), PAYTM_IV);
    const plain = Buffer.concat([d.update(Buffer.from(checksum, 'base64')), d.final()]).toString(
      'utf8',
    );
    if (plain.length < 68) return false;
    const salt = plain.slice(64);
    const joined = Object.keys(params)
      .sort()
      .map((k) => (params[k] && params[k].toLowerCase() !== 'null' ? params[k] : ''))
      .join('|');
    return safeEqual(hashHex('sha256', `${joined}|${salt}`), plain.slice(0, 64));
  } catch {
    return false;
  }
}

/** Paytm (TW-PAYGW-022): initiate a transaction token, redirect to the pay page, confirm the signed return with the status API. */
export class PaytmDriver implements PaymentDriver {
  readonly slug = 'paytm';

  constructor(private readonly ctx: DriverContext) {}

  private get base(): string {
    return sandbox(this.ctx) ? 'https://securegw-stage.paytm.in' : 'https://securegw.paytm.in';
  }

  private creds() {
    const c = this.ctx.credentials;
    return { mid: c.merchant_id ?? '', key: c.merchant_key ?? '', website: c.website ?? '' };
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    const { mid, key, website } = this.creds();
    if (!mid || !key || !website) return Promise.resolve(failed('paytm_credentials_missing'));
    return guard('paytm', async () => {
      const orderId = `PAYTM_${order.orderNumber}_${Date.now()}`;
      const body = {
        requestType: 'Payment',
        mid,
        websiteName: website,
        orderId,
        callbackUrl: urls.returnUrl,
        txnAmount: { value: order.amountMajor, currency: order.currency },
        userInfo: { custId: order.orderNumber },
      };
      const res = await this.ctx.http(
        `${this.base}/theia/api/v1/initiateTransaction?mid=${encodeURIComponent(mid)}&orderId=${encodeURIComponent(orderId)}`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            body,
            head: { signature: paytmChecksum(JSON.stringify(body), key) },
          }),
        },
      );
      const b = asRecord(asRecord(res.json).body);
      const info = asRecord(b.resultInfo);
      if (info.resultCode === 'S' && str(b.txnToken)) {
        return pending({
          redirectUrl: `${this.base}/theia/api/v1/showPaymentPage?mid=${encodeURIComponent(mid)}&orderId=${encodeURIComponent(orderId)}&txnToken=${encodeURIComponent(String(b.txnToken))}`,
          gatewayOrderId: orderId,
        });
      }
      return failed(`paytm: ${str(info.resultMsg) ?? 'init_failed'}`);
    });
  }

  private async status(orderId: string, order: DriverOrder): Promise<PaymentResult | null> {
    const { mid, key } = this.creds();
    try {
      const body = { mid, orderId };
      const res = await this.ctx.http(`${this.base}/v3/order/status`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          body,
          head: { signature: paytmChecksum(JSON.stringify(body), key) },
        }),
      });
      const b = asRecord(asRecord(res.json).body);
      const info = asRecord(b.resultInfo);
      if (info.resultCode === '01' || info.resultStatus === 'TXN_SUCCESS') {
        if (b.txnAmount !== undefined && !moneyMatches(order, b.txnAmount))
          return failed('paytm_amount_mismatch');
        return paid(String(b.txnId ?? orderId), { status: b });
      }
      if (info.resultStatus === 'PENDING') return pending({ gatewayOrderId: orderId });
      return null;
    } catch {
      return null;
    }
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const orderId = params.ORDERID;
    if (!orderId) return failed('missing_paytm_order_id');
    if (order.gatewayOrderId && order.gatewayOrderId !== orderId)
      return failed('paytm_order_mismatch');
    const { key } = this.creds();
    const { CHECKSUMHASH, ...rest } = params;
    // The return is a browser POST: only the checksum proves Paytm sent it.
    if (
      !CHECKSUMHASH ||
      !paytmVerify(
        Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'o')),
        key,
        CHECKSUMHASH,
      )
    )
      return failed('paytm_checksum_invalid');
    const viaApi = await this.status(orderId, order);
    if (viaApi) return viaApi;
    if (params.STATUS === 'TXN_SUCCESS') {
      if (params.TXNAMOUNT !== undefined && !moneyMatches(order, params.TXNAMOUNT))
        return failed('paytm_amount_mismatch');
      return paid(params.BANKTXNID ?? orderId, { return: rest });
    }
    return failed(`paytm: ${params.RESPMSG ?? `status: ${params.STATUS ?? ''}`}`);
  }

  async verifyWebhook(): Promise<boolean> {
    return false;
  }

  parseWebhook(): WebhookPayment | null {
    return null;
  }
}

// ---- PhonePe -----------------------------------------------------------------------------------------------------------

/** PhonePe (TW-PAYGW-022): Standard Checkout v2 (OAuth) when client id and secret are set, the legacy salt-key flow otherwise. */
export class PhonePeDriver implements PaymentDriver {
  readonly slug = 'phonepe';

  constructor(private readonly ctx: DriverContext) {}

  private get c(): Record<string, string> {
    return this.ctx.credentials;
  }

  private get v2(): boolean {
    return !!this.c.client_id && !!this.c.client_secret;
  }

  private get legacyBase(): string {
    return sandbox(this.ctx)
      ? 'https://api-preprod.phonepe.com/apis/pg-sandbox'
      : 'https://api.phonepe.com/apis/hermes';
  }

  private get v2Base(): string {
    return sandbox(this.ctx)
      ? 'https://api-preprod.phonepe.com/apis/pg-sandbox'
      : 'https://api.phonepe.com/apis/pg';
  }

  private async token(): Promise<string | null> {
    const url = sandbox(this.ctx)
      ? 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token'
      : 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token';
    try {
      const res = await this.ctx.http(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: urlForm({
          client_id: this.c.client_id,
          client_version: this.c.client_version || '1',
          client_secret: this.c.client_secret,
          grant_type: 'client_credentials',
        }),
      });
      return str(asRecord(res.json).access_token) ?? null;
    } catch {
      return null;
    }
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('phonepe', () =>
      this.v2 ? this.initV2(order, urls) : this.initLegacy(order, urls),
    );
  }

  private async initV2(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    const token = await this.token();
    if (!token)
      return failed(
        'phonepe: auth failed. Check Client ID / Secret / Version and mode (live vs test).',
      );
    const id = `PP_${safeId(order.orderNumber)}_${Date.now()}`.slice(0, 63);
    const res = await this.ctx.http(`${this.v2Base}/checkout/v2/pay`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, Authorization: `O-Bearer ${token}` },
      body: JSON.stringify({
        merchantOrderId: id,
        amount: Number(order.amountMinor),
        expireAfter: 1200,
        paymentFlow: { type: 'PG_CHECKOUT', merchantUrls: { redirectUrl: urls.returnUrl } },
      }),
    });
    const j = asRecord(res.json);
    return str(j.redirectUrl)
      ? pending({ redirectUrl: str(j.redirectUrl), gatewayOrderId: id })
      : failed(`phonepe: ${str(j.message) ?? str(j.code) ?? 'init_failed'}`);
  }

  private async initLegacy(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    const { merchant_id: mid, salt_key: salt, salt_index: idx } = this.c;
    if (!mid || !salt || !idx) {
      return failed(
        'phonepe_credentials_missing: enter Client ID/Secret (v2) or Merchant ID/Salt (legacy).',
      );
    }
    const txId = `PP_${order.orderNumber}_${Date.now()}`;
    const payload = Buffer.from(
      JSON.stringify({
        merchantId: mid,
        merchantTransactionId: txId,
        merchantUserId: `USER_${order.orderNumber}`,
        amount: Number(order.amountMinor),
        redirectUrl: urls.returnUrl,
        redirectMode: 'REDIRECT',
        callbackUrl: urls.notifyUrl,
        paymentInstrument: { type: 'PAY_PAGE' },
      }),
    ).toString('base64');
    const res = await this.ctx.http(`${this.legacyBase}/pg/v1/pay`, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        'X-VERIFY': `${hashHex('sha256', `${payload}/pg/v1/pay${salt}`)}###${idx}`,
      },
      body: JSON.stringify({ request: payload }),
    });
    const j = asRecord(res.json);
    const url = str(asRecord(asRecord(asRecord(j.data).instrumentResponse).redirectInfo).url);
    return j.success === true && url
      ? pending({ redirectUrl: url, gatewayOrderId: txId })
      : failed(`phonepe: ${str(j.message) ?? 'init_failed'}`);
  }

  /** What PhonePe says about one transaction. The id comes from OUR stored order or a notification, never trusted on its own. */
  private async remote(id: string): Promise<{
    state: 'paid' | 'pending' | 'other';
    code: string;
    amount?: number;
    txn: string;
    json: unknown;
  } | null> {
    if (this.v2) {
      const token = await this.token();
      if (!token) return null;
      const res = await this.ctx.http(
        `${this.v2Base}/checkout/v2/order/${encodeURIComponent(id)}/status`,
        {
          method: 'GET',
          headers: { ...JSON_HEADERS, Authorization: `O-Bearer ${token}` },
        },
      );
      const j = asRecord(res.json);
      const code = (str(j.state) ?? '').toUpperCase();
      const det = Array.isArray(j.paymentDetails) ? asRecord(j.paymentDetails[0]) : {};
      return {
        state: code === 'COMPLETED' ? 'paid' : code === 'PENDING' ? 'pending' : 'other',
        code,
        amount: typeof j.amount === 'number' ? j.amount : undefined,
        txn: str(det.transactionId) ?? str(j.orderId) ?? id,
        json: j,
      };
    }
    const { merchant_id: mid, salt_key: salt, salt_index: idx } = this.c;
    const endpoint = `/pg/v1/status/${mid}/${id}`;
    const res = await this.ctx.http(`${this.legacyBase}${endpoint}`, {
      method: 'GET',
      headers: {
        ...JSON_HEADERS,
        'X-VERIFY': `${hashHex('sha256', `${endpoint}${salt}`)}###${idx}`,
        'X-MERCHANT-ID': mid ?? '',
      },
    });
    const j = asRecord(res.json);
    const data = asRecord(j.data);
    const code = String(j.code ?? '');
    return {
      state: code === 'PAYMENT_SUCCESS' ? 'paid' : code === 'PAYMENT_PENDING' ? 'pending' : 'other',
      code,
      amount: typeof data.amount === 'number' ? data.amount : undefined,
      txn: str(data.transactionId) ?? id,
      json: j,
    };
  }

  private queryStatus(id: string, order: DriverOrder): Promise<PaymentResult> {
    return guard('phonepe_status', async () => {
      const r = await this.remote(id);
      if (!r) return failed('phonepe_v2_auth_failed');
      if (r.state === 'pending') return pending({ gatewayOrderId: id });
      if (r.state !== 'paid') return failed(`phonepe_status: ${r.code}`);
      if (r.amount !== undefined && BigInt(Math.round(r.amount)) !== order.amountMinor)
        return failed('phonepe_amount_mismatch');
      return paid(r.txn, { status: r.json });
    });
  }

  async confirmReturn(_params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    if (!order.gatewayOrderId) return failed('missing_phonepe_merchant_tx');
    return this.queryStatus(order.gatewayOrderId, order);
  }

  /**
   * v2 notifications are not signed with anything we hold, so the notification is only a hint: it is accepted when PhonePe's own
   * status API confirms the order. Legacy notifications carry `X-VERIFY` over the base64 response with the salt key.
   */
  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    let body: Record<string, unknown>;
    try {
      body = asRecord(JSON.parse(rawBody.toString('utf8')));
    } catch {
      return false;
    }
    if (!this.v2) {
      const x = header(headers, 'x-verify');
      const resp = str(body.response);
      const { salt_key: salt, salt_index: idx } = this.c;
      return (
        !!x && !!resp && !!salt && safeEqual(`${hashHex('sha256', `${resp}${salt}`)}###${idx}`, x)
      );
    }
    const id = str(asRecord(body.payload ?? body).merchantOrderId);
    if (!id) return false;
    try {
      return (await this.remote(id))?.state === 'paid';
    } catch {
      return false;
    }
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const b = asRecord(body);
    if (this.v2) {
      const inner = asRecord(b.payload ?? b);
      return str(inner.state) === 'COMPLETED' || str(b.event) === 'checkout.order.completed'
        ? {
            gatewayOrderId: str(inner.merchantOrderId),
            gatewayPaymentId: str(inner.orderId),
            payload: { notification: inner },
          }
        : null;
    }
    try {
      const decoded = asRecord(
        JSON.parse(Buffer.from(String(b.response), 'base64').toString('utf8')),
      );
      const data = asRecord(decoded.data);
      return decoded.code === 'PAYMENT_SUCCESS'
        ? {
            gatewayOrderId: str(data.merchantTransactionId),
            gatewayPaymentId: str(data.transactionId),
            amountMinor: typeof data.amount === 'number' ? BigInt(data.amount) : undefined,
            payload: { notification: decoded },
          }
        : null;
    } catch {
      return null;
    }
  }
}

// ---- Cashfree ----------------------------------------------------------------------------------------------------------

/** Cashfree (TW-PAYGW-022): a payment session the browser opens with Cashfree's JS checkout (Reference inlined that script). */
export class CashfreeDriver implements PaymentDriver {
  readonly slug = 'cashfree';

  constructor(private readonly ctx: DriverContext) {}

  private get base(): string {
    return sandbox(this.ctx) ? 'https://sandbox.cashfree.com/pg' : 'https://api.cashfree.com/pg';
  }

  private get headers(): Record<string, string> {
    return {
      ...JSON_HEADERS,
      'x-client-id': this.ctx.credentials.app_id ?? '',
      'x-client-secret': this.ctx.credentials.secret_key ?? '',
      'x-api-version': '2023-08-01',
    };
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    if (!this.ctx.credentials.app_id || !this.ctx.credentials.secret_key)
      return Promise.resolve(failed('cashfree_credentials_missing'));
    if (!order.customerEmail) return Promise.resolve(failed('cashfree_customer_email_missing'));
    return guard('cashfree', async () => {
      const orderId = `CF_${order.orderNumber}_${Date.now()}`;
      const sep = urls.returnUrl.includes('?') ? '&' : '?';
      const res = await this.ctx.http(`${this.base}/orders`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          order_id: orderId,
          order_amount: Number(order.amountMajor),
          order_currency: order.currency,
          customer_details: {
            customer_id: order.orderNumber,
            customer_name: order.customerName ?? 'Customer',
            customer_email: order.customerEmail,
            customer_phone: '9999999999',
          },
          // `{order_id}` is Cashfree's own placeholder.
          order_meta: {
            return_url: `${urls.returnUrl}${sep}order_id={order_id}`,
            notify_url: urls.notifyUrl,
          },
          order_note: `Order #${order.orderNumber}`,
        }),
      });
      const j = asRecord(res.json);
      const session = str(j.payment_session_id);
      return session
        ? pending({
            gatewayOrderId: orderId,
            clientAction: {
              provider: 'cashfree',
              params: {
                sessionId: session,
                mode: sandbox(this.ctx) ? 'sandbox' : 'production',
              },
            },
          })
        : failed(`cashfree: ${str(j.message) ?? 'create_failed'}`);
    });
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const orderId = params.order_id;
    if (!orderId) return failed('missing_cashfree_order_id');
    if (order.gatewayOrderId && order.gatewayOrderId !== orderId)
      return failed('cashfree_order_mismatch');
    return guard('cashfree_callback', async () => {
      const res = await this.ctx.http(`${this.base}/orders/${encodeURIComponent(orderId)}`, {
        method: 'GET',
        headers: this.headers,
      });
      const j = asRecord(res.json);
      if (j.order_status !== 'PAID')
        return failed(`cashfree_status: ${str(j.order_status) ?? 'unknown'}`);
      if (!moneyMatches(order, j.order_amount, j.order_currency))
        return failed('cashfree_amount_mismatch');
      return paid(String(j.cf_order_id ?? orderId), { order: j });
    });
  }

  /**
   * `x-webhook-signature` = base64 HMAC-SHA256 over `x-webhook-timestamp + raw body` with the secret key. Reference read neither header
   * and accepted every call; this checks the signature Cashfree documents.
   */
  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<boolean> {
    const secret = this.ctx.credentials.secret_key;
    const sig = header(headers, 'x-webhook-signature');
    const ts = header(headers, 'x-webhook-timestamp');
    return (
      !!secret &&
      !!sig &&
      !!ts &&
      safeEqual(hmacB64('sha256', secret, ts + rawBody.toString('utf8')), sig)
    );
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const evt = asRecord(body);
    if (evt.type !== 'PAYMENT_SUCCESS_WEBHOOK') return null;
    const d = asRecord(evt.data);
    const o = asRecord(d.order);
    const p = asRecord(d.payment);
    const currency = str(p.payment_currency)?.toUpperCase();
    return {
      gatewayOrderId: str(o.order_id),
      gatewayPaymentId: str(o.order_id),
      amountMinor: currency ? (minorOf(p.payment_amount, currency) ?? undefined) : undefined,
      currency,
      payload: { data: d },
    };
  }
}

// ---- PayU --------------------------------------------------------------------------------------------------------------

/** PayU (TW-PAYGW-022): a signed form POST to PayU; the return is a signed form POST back (reverse hash). */
export class PayuDriver implements PaymentDriver {
  readonly slug = 'payu';

  constructor(private readonly ctx: DriverContext) {}

  async initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    const { merchant_key: key, merchant_salt: salt } = this.ctx.credentials;
    if (!key || !salt) return failed('payu_credentials_missing');
    if (!order.customerEmail) return failed('payu_customer_email_missing');
    const txnid = `PAYU_${order.orderNumber}_${Date.now()}`;
    const productinfo = `Order #${order.orderNumber}`;
    const firstname = order.customerName ?? 'Customer';
    // udf2 carried Reference's internal order id; ours stays empty (internal ids never leave the system).
    const hash = hashHex(
      'sha512',
      [
        key,
        txnid,
        order.amountMajor,
        productinfo,
        firstname,
        order.customerEmail,
        order.orderNumber,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        salt,
      ].join('|'),
    );
    return pending({
      gatewayOrderId: txnid,
      payload: { txnid },
      formPost: {
        url: sandbox(this.ctx)
          ? 'https://sandboxsecure.payu.in/_payment'
          : 'https://secure.payu.in/_payment',
        fields: {
          key,
          txnid,
          amount: order.amountMajor,
          productinfo,
          firstname,
          email: order.customerEmail,
          phone: '9999999999',
          surl: urls.returnUrl,
          furl: withQuery(urls.returnUrl, { status: 'failed' }),
          hash,
          udf1: order.orderNumber,
        },
      },
    });
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const { merchant_key: key, merchant_salt: salt } = this.ctx.credentials;
    const txnid = params.txnid;
    if (!txnid) return failed('missing_payu_txnid');
    if (order.gatewayOrderId && order.gatewayOrderId !== txnid)
      return failed('payu_txnid_mismatch');
    if (!params.hash) return failed('missing_payu_hash');
    const g = (k: string): string => params[k] ?? '';
    const reverse = [
      salt,
      g('status'),
      '',
      '',
      '',
      '',
      '',
      g('udf5'),
      g('udf4'),
      g('udf3'),
      g('udf2'),
      g('udf1'),
      g('email'),
      g('firstname'),
      g('productinfo'),
      g('amount'),
      txnid,
      key,
    ].join('|');
    if (!safeEqual(hashHex('sha512', reverse), params.hash.toLowerCase()))
      return failed('payu_hash_mismatch');
    if (params.status === 'success') {
      if (!moneyMatches(order, params.amount)) return failed('payu_amount_mismatch');
      return paid(params.mihpayid ?? txnid, { return: params });
    }
    return failed(`payu: ${params.error_Message ?? `status: ${params.status ?? ''}`}`);
  }

  async verifyWebhook(): Promise<boolean> {
    return false;
  }

  parseWebhook(): WebhookPayment | null {
    return null;
  }
}

// ---- Instamojo ---------------------------------------------------------------------------------------------------------

/** Instamojo (TW-PAYGW-022): payment request + hosted page, verified with the payment API; webhooks carry a SHA1 MAC (salt). */
export class InstamojoDriver implements PaymentDriver {
  readonly slug = 'instamojo';

  constructor(private readonly ctx: DriverContext) {}

  private get base(): string {
    return sandbox(this.ctx)
      ? 'https://test.instamojo.com/api/1.1'
      : 'https://www.instamojo.com/api/1.1';
  }

  private get auth(): Record<string, string> {
    return {
      'X-Api-Key': this.ctx.credentials.api_key ?? '',
      'X-Auth-Token': this.ctx.credentials.auth_token ?? '',
    };
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    if (!this.ctx.credentials.api_key || !this.ctx.credentials.auth_token)
      return Promise.resolve(failed('instamojo_credentials_missing'));
    if (!order.customerEmail) return Promise.resolve(failed('instamojo_customer_email_missing'));
    return guard('instamojo', async () => {
      const res = await this.ctx.http(`${this.base}/payment-requests/`, {
        method: 'POST',
        headers: { ...this.auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: urlForm({
          purpose: `Order #${order.orderNumber}`,
          amount: order.amountMajor,
          buyer_name: order.customerName ?? 'Customer',
          email: order.customerEmail,
          redirect_url: urls.returnUrl,
          webhook: urls.notifyUrl,
          allow_repeated_payments: 'false',
          send_email: 'false',
        }),
      });
      const j = asRecord(res.json);
      const pr = asRecord(j.payment_request);
      if (j.success === true && str(pr.longurl)) {
        return pending({ redirectUrl: str(pr.longurl), gatewayOrderId: str(pr.id) });
      }
      const m = j.message;
      return failed(
        `instamojo: ${typeof m === 'string' ? m : m ? JSON.stringify(m) : 'create_failed'}`,
      );
    });
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const paymentId = params.payment_id;
    const requestId = params.payment_request_id;
    if (!paymentId || !requestId) return failed('missing_instamojo_params');
    if (order.gatewayOrderId && order.gatewayOrderId !== requestId)
      return failed('instamojo_request_mismatch');
    return guard('instamojo_callback', async () => {
      const res = await this.ctx.http(
        `${this.base}/payment-requests/${encodeURIComponent(requestId)}/${encodeURIComponent(paymentId)}/`,
        {
          method: 'GET',
          headers: this.auth,
        },
      );
      if (!isOk(res)) return failed(`instamojo_http_${res.status}`);
      const pay = asRecord(asRecord(asRecord(res.json).payment_request).payment);
      const status = str(pay.status) ?? '';
      if (status !== 'Credit') return failed(`instamojo_status: ${status}`);
      if (!moneyMatches(order, pay.amount)) return failed('instamojo_amount_mismatch');
      return paid(paymentId, { payment: pay });
    });
  }

  /** Form-encoded body; `mac` = HMAC-SHA1 (salt) over the other values sorted by key and joined with `|`. */
  async verifyWebhook(rawBody: Buffer): Promise<boolean> {
    const salt = this.ctx.credentials.salt;
    const { mac, ...rest } = parseForm(rawBody);
    if (!salt || !mac) return false;
    const joined = Object.keys(rest)
      .sort()
      .map((k) => rest[k])
      .join('|');
    return safeEqual(hmacHex('sha1', salt, joined), mac);
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const b = asRecord(body);
    if (b.status !== 'Credit') return null;
    return {
      gatewayOrderId: str(b.payment_request_id),
      gatewayPaymentId: str(b.payment_id),
      amountMinor: minorOf(b.amount, 'INR') ?? undefined,
      payload: { notification: b },
    };
  }
}

export { CANCELLED_BY_USER };
