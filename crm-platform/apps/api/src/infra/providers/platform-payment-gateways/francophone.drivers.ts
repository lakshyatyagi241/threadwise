import {
  JSON_HEADERS,
  asRecord,
  bearer,
  failed,
  guard,
  minorOf,
  moneyMatches,
  notificationFields,
  paid,
  pending,
  str,
  urlForm,
  type DriverContext,
  type DriverOrder,
  type DriverUrls,
  type PaymentDriver,
  type PaymentResult,
  type WebhookPayment,
} from './payment-driver';

const safeDash = (s: string): string => s.replace(/[^A-Za-z0-9-]/g, '');

// ---- CinetPay ----------------------------------------------------------------------------------------------------------

const CINET = 'https://api-checkout.cinetpay.com/v2';
/** CinetPay only takes these currencies in multiples of 5. */
const MULTIPLE_OF_5 = ['XOF', 'XAF', 'CDF', 'GNF'];

/** The whole-number amount CinetPay is asked for (rounded to a multiple of 5 where required). Exported for the tests. */
export function cinetpayAmount(o: Pick<DriverOrder, 'amountMajor' | 'currency'>): number {
  const n = Math.round(Number(o.amountMajor));
  return MULTIPLE_OF_5.includes(o.currency) && n % 5 !== 0 ? Math.round(n / 5) * 5 : n;
}

/**
 * CinetPay (WD-PAYGW-025 rule 1): a payment page for mobile money and cards. The return and the notification both ask
 * `/payment/check` for the transaction (the notification carries no usable signature), and the transaction id must be OURS.
 */
export class CinetpayDriver implements PaymentDriver {
  readonly slug = 'cinetpay';
  private readonly verified = new Map<string, WebhookPayment>();

  constructor(private readonly ctx: DriverContext) {}

  private get c(): { key: string; site: string } {
    return { key: this.ctx.credentials.api_key ?? '', site: this.ctx.credentials.site_id ?? '' };
  }

  private post(path: string, body: Record<string, unknown>) {
    return this.ctx.http(`${CINET}${path}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('cinetpay', async () => {
      const { key, site } = this.c;
      if (!key || !site) return failed('cinetpay_credentials_missing');
      if (!order.customerEmail) return failed('cinetpay_customer_email_missing');
      const txId = `CINET-${safeDash(order.orderNumber)}-${Math.floor(Date.now() / 1000)}`;
      const parts = (order.customerName ?? 'Customer').trim().split(/\s+/);
      const res = await this.post('/payment', {
        apikey: key,
        site_id: site,
        transaction_id: txId,
        amount: cinetpayAmount(order),
        currency: order.currency,
        description: `Order #${order.orderNumber}`,
        return_url: urls.returnUrl,
        notify_url: urls.notifyUrl,
        channels: 'ALL',
        lang: 'en',
        metadata: JSON.stringify({ order_number: order.orderNumber }),
        customer_id: order.orderNumber,
        customer_name: parts[0] || 'Customer',
        customer_surname: parts.length > 1 ? parts.slice(1).join(' ') : 'Customer',
        customer_email: order.customerEmail,
        // CinetPay requires these; the billing form does not collect a phone, so the documented placeholders are sent.
        customer_phone_number: '',
        customer_address: 'N/A',
        customer_city: 'N/A',
        customer_country: 'CI',
        customer_state: 'CI',
        customer_zip_code: '00000',
      });
      const j = asRecord(res.json);
      const url = str(asRecord(j.data).payment_url);
      if (String(j.code ?? '') === '201' && url)
        return pending({ redirectUrl: url, gatewayOrderId: txId });
      return failed(
        `cinetpay: ${`${str(j.message) ?? 'create_failed'} ${str(j.description) ?? ''}`.trim()}`,
      );
    });
  }

  private async check(txId: string): Promise<Record<string, unknown>> {
    const { key, site } = this.c;
    return asRecord(
      (await this.post('/payment/check', { apikey: key, site_id: site, transaction_id: txId }))
        .json,
    );
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const txId = params.transaction_id ?? params.cpm_trans_id;
    if (!txId) return failed('missing_cinetpay_tx');
    if (order.gatewayOrderId && order.gatewayOrderId !== txId)
      return failed('cinetpay_transaction_mismatch');
    return guard('cinetpay_callback', async () => {
      const j = await this.check(txId);
      const code = String(j.code ?? '');
      if (code !== '00') return failed(`cinetpay_check_code: ${code}`);
      const d = asRecord(j.data);
      const status = str(d.status) ?? '';
      if (status !== 'ACCEPTED') {
        return status === 'REFUSED' || status === 'CANCELED'
          ? failed(`cinetpay_status: ${status}`)
          : pending({ gatewayOrderId: txId });
      }
      if (
        !moneyMatches(
          { ...order, amountMinor: BigInt(cinetpayAmount(order)) },
          d.amount,
          d.currency,
        )
      )
        return failed('cinetpay_amount_mismatch');
      return paid(txId, { check: j });
    });
  }

  /** No signature is used: a notification counts only when CinetPay's own check says this transaction is accepted. */
  async verifyWebhook(rawBody: Buffer): Promise<boolean> {
    const txId = str(notificationFields(rawBody).cpm_trans_id);
    if (!txId || !txId.startsWith('CINET-')) return false;
    try {
      const j = await this.check(txId);
      const d = asRecord(j.data);
      if (String(j.code ?? '') !== '00' || d.status !== 'ACCEPTED') return false;
      const cur = str(d.currency)?.toUpperCase();
      this.verified.set(txId, {
        gatewayOrderId: txId,
        gatewayPaymentId: txId,
        amountMinor: cur ? (minorOf(d.amount, cur) ?? undefined) : undefined,
        currency: cur,
        payload: { check: j },
      });
      return true;
    } catch {
      return false;
    }
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const id = str(asRecord(body).cpm_trans_id);
    const v = id ? this.verified.get(id) : undefined;
    if (!v) return null;
    // The check reports what was collected, which is the rounded amount we asked for: the receiver's comparison needs the
    // order's own total, so only the currency is compared here (the amount was already pinned when the page was created).
    return { ...v, amountMinor: undefined };
  }
}

// ---- LigdiCash ---------------------------------------------------------------------------------------------------------

const LIGDI = 'https://app.ligdicash.com/pay/v01';

/**
 * LigdiCash (WD-PAYGW-025 rule 2): XOF only. WaDesk relabelled any other currency as XOF without converting; here a non-XOF
 * order is refused. The return and the notification confirm by the invoice token through LigdiCash's confirm call.
 */
export class LigdicashDriver implements PaymentDriver {
  readonly slug = 'ligdicash';
  private readonly verified = new Map<string, WebhookPayment>();

  constructor(private readonly ctx: DriverContext) {}

  private headers(): Record<string, string> {
    return {
      ...JSON_HEADERS,
      Apikey: this.ctx.credentials.api_key ?? '',
      Authorization: bearer(this.ctx.credentials.api_token ?? ''),
    };
  }

  initiate(order: DriverOrder, urls: DriverUrls): Promise<PaymentResult> {
    return guard('ligdicash', async () => {
      const { api_key: key, api_token: token, store_name: store } = this.ctx.credentials;
      if (!key || !token) return failed('ligdicash_credentials_missing');
      if (order.currency !== 'XOF')
        return failed('ligdicash_currency_unsupported: only XOF is accepted');
      const amount = Math.round(Number(order.amountMajor));
      if (amount <= 0) return failed('ligdicash_invalid_amount');
      const name = `Order #${order.orderNumber}`;
      const res = await this.ctx.http(`${LIGDI}/redirect/checkout-invoice/create`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          commande: {
            invoice: {
              items: [
                { name, description: name, quantity: 1, unit_price: amount, total_price: amount },
              ],
              total_amount: amount,
              devise: 'XOF',
              description: name,
              customer: '',
              customer_firstname: order.customerName ?? '',
              customer_lastname: '',
              customer_email: order.customerEmail ?? '',
              external_id: order.orderNumber,
              otp: '',
            },
            store: { name: store?.trim() || 'Store', website_url: urls.returnUrl.split('/v2/')[0] },
            actions: {
              cancel_url: urls.returnUrl,
              return_url: urls.returnUrl,
              callback_url: urls.notifyUrl,
            },
            custom_data: { order_number: order.orderNumber, transaction_id: order.orderNumber },
          },
        }),
      });
      const j = asRecord(res.json);
      if (String(j.response_code ?? '') === '00' && str(j.response_text)) {
        return pending({ redirectUrl: str(j.response_text), gatewayOrderId: str(j.token) });
      }
      return failed(`ligdicash: ${str(j.response_text) ?? str(j.description) ?? 'create_failed'}`);
    });
  }

  private async confirm(token: string): Promise<Record<string, unknown>> {
    const res = await this.ctx.http(
      `${LIGDI}/redirect/checkout-invoice/confirm?${urlForm({ invoiceToken: token })}`,
      { method: 'GET', headers: this.headers() },
    );
    return asRecord(res.json);
  }

  async confirmReturn(params: Record<string, string>, order: DriverOrder): Promise<PaymentResult> {
    const token = params.token ?? params.invoiceToken ?? params.invoice_token;
    if (!token) return failed('missing_ligdicash_token');
    if (order.gatewayOrderId && order.gatewayOrderId !== token)
      return failed('ligdicash_token_mismatch');
    return guard('ligdicash_confirm', async () => {
      const j = await this.confirm(token);
      const code = String(j.response_code ?? '');
      if (code !== '00') return failed(`ligdicash_confirm_code: ${code}`);
      const status = (str(j.status) ?? '').toLowerCase();
      if (status !== 'completed')
        return status === 'pending'
          ? pending({ gatewayOrderId: token })
          : failed(`ligdicash_status: ${status}`);
      const ref = str(j.external_id) ?? str(asRecord(j.custom_data).order_number);
      if (ref && ref !== order.orderNumber) return failed('ligdicash_reference_mismatch');
      return paid(str(j.request_id) ?? token, { confirm: j });
    });
  }

  /** No signature exists: accepted only when LigdiCash's own confirm call reports the invoice completed. */
  async verifyWebhook(rawBody: Buffer): Promise<boolean> {
    const f = notificationFields(rawBody);
    const token = str(f.token) ?? str(f.invoiceToken) ?? str(f.invoice_token);
    if (!token || !this.ctx.credentials.api_key) return false;
    try {
      const j = await this.confirm(token);
      if (
        String(j.response_code ?? '') !== '00' ||
        (str(j.status) ?? '').toLowerCase() !== 'completed'
      )
        return false;
      this.verified.set(token, {
        orderNumber: str(j.external_id) ?? str(asRecord(j.custom_data).order_number),
        gatewayOrderId: token,
        gatewayPaymentId: str(j.request_id) ?? token,
        payload: { confirm: j },
      });
      return true;
    } catch {
      return false;
    }
  }

  parseWebhook(body: unknown): WebhookPayment | null {
    const f = asRecord(body);
    const token = str(f.token) ?? str(f.invoiceToken) ?? str(f.invoice_token);
    return (token && this.verified.get(token)) || null;
  }
}
