import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  GATEWAY_CATALOGUE,
  createDriver,
  hasDriver,
  type DriverContext,
  type DriverOrder,
  type HttpFetch,
  type HttpResponse,
  type PinnedFetch,
} from '../../../src/infra/providers/platform-payment-gateways';
import { sslcommerzSign } from '../../../src/infra/providers/platform-payment-gateways/asia.drivers';
import {
  fondySign,
  iyzicoPki,
  paytrNotificationHash,
  skrillSignature,
  TwocheckoutDriver,
} from '../../../src/infra/providers/platform-payment-gateways/europe.drivers';
import { cinetpayAmount } from '../../../src/infra/providers/platform-payment-gateways/francophone.drivers';
import {
  braintreeSignature,
  squareSignature,
} from '../../../src/infra/providers/platform-payment-gateways/us.drivers';

/**
 * P2 drivers against recorded provider answers: Lemon Squeezy, Mollie, Square, Braintree, Authorize.Net, Midtrans, Duitku,
 * Xendit, Tap, HyperPay, SSLCommerz, iyzico, PayTR, Fondy, Skrill, 2Checkout, Coinbase, Mercado Pago, CinetPay and LigdiCash.
 * No network: every call goes through the injected fetch. Each driver is held to the same rule: a redirect parameter or an
 * unsigned body is never proof of payment, the order reference and the amount are checked against OUR order.
 */
const order: DriverOrder = {
  orderNumber: 'WSN-261005-ABC123',
  amountMinor: 4602n,
  amountMajor: '46.02',
  currency: 'USD',
  description: 'Growth plan',
  planName: 'Growth',
  customerName: 'Ada Buyer',
  customerEmail: 'buyer@example.com',
  gatewayOrderId: null,
};
const idr: DriverOrder = {
  ...order,
  currency: 'IDR',
  amountMinor: 15000000n,
  amountMajor: '150000.00',
};
const urls = {
  returnUrl: 'https://api.test/v2/payments/return/x?o=tok',
  notifyUrl: 'https://api.test/v2/payments/webhook/x',
};

const res = (status: number, body: unknown): HttpResponse => ({
  status,
  json: typeof body === 'string' ? null : body,
  text: typeof body === 'string' ? body : JSON.stringify(body),
});
const ctx = (
  credentials: Record<string, string>,
  http: HttpFetch,
  mode: 'sandbox' | 'live' = 'sandbox',
  webhookUrl?: string,
): DriverContext => ({ credentials, mode, http, webhookUrl });
const never: HttpFetch = async () => {
  throw new Error('no network in this test');
};
/** A fetch that answers by URL fragment, recording every call. */
type Init = { method: string; body?: string };
const routes = (table: Record<string, unknown>) =>
  vi.fn<HttpFetch>(async (url, init) => {
    const key = Object.keys(table).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected call ${url}`);
    const v = table[key];
    return res(200, typeof v === 'function' ? (v as (i: Init) => unknown)(init) : v);
  });
const callTo = (http: ReturnType<typeof vi.fn<HttpFetch>>, frag: string) =>
  http.mock.calls.find((c) => c[0].includes(frag))!;
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const sha = (a: 'sha1' | 'sha256' | 'sha512', s: string) => createHash(a).update(s).digest('hex');
const form = (o: Record<string, string>) => Buffer.from(new URLSearchParams(o).toString());
const json = (o: unknown) => Buffer.from(JSON.stringify(o));

describe('registry', () => {
  it('has a working driver for every gateway of the catalogue', () => {
    for (const g of GATEWAY_CATALOGUE) expect(hasDriver(g.slug), g.slug).toBe(true);
  });
});

describe('Midtrans (TW-PAYGW-023)', () => {
  const creds = { server_key: 'SB-key', client_key: 'ck' };
  it('rounds the gross amount to whole rupiah and sends the finish URL with our order id', async () => {
    const http = routes({
      '/snap/v1/transactions': { token: 't', redirect_url: 'https://pay.midtrans.test/x' },
    });
    const d = createDriver('midtrans', ctx(creds, http));
    const r = await d.initiate({ ...idr, amountMajor: '149.99' }, urls);
    expect(r).toMatchObject({ status: 'pending', redirectUrl: 'https://pay.midtrans.test/x' });
    const sent = JSON.parse(String(callTo(http, 'snap')[1].body));
    expect(sent.transaction_details.gross_amount).toBe(150);
    expect(sent.transaction_details.order_id).toBe(r.gatewayOrderId);
    expect(sent.callbacks.finish).toContain(`order_id=${r.gatewayOrderId}`);
    expect(callTo(http, 'snap')[1].headers!.Authorization).toMatch(/^Basic /);
    expect(
      (
        await createDriver('midtrans', ctx(creds, never)).initiate(
          { ...idr, customerEmail: null },
          urls,
        )
      ).error,
    ).toBe('midtrans_customer_email_missing');
  });

  it('pays on settlement (or accepted capture), for the right amount, and only for our own order id', async () => {
    const http = routes({
      '/status': {
        transaction_status: 'settlement',
        transaction_id: 'T1',
        gross_amount: '150000.00',
        currency: 'IDR',
      },
    });
    const d = createDriver('midtrans', ctx(creds, http));
    const o = { ...idr, gatewayOrderId: 'MID_X_1' };
    expect(await d.confirmReturn({ order_id: 'MID_X_1' }, o)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'T1',
    });
    expect((await d.confirmReturn({ order_id: 'MID_OTHER' }, o)).error).toBe(
      'midtrans_order_mismatch',
    );
    expect((await d.confirmReturn({}, o)).error).toBe('missing_midtrans_order_id');
    const cheap = routes({ '/status': { transaction_status: 'settlement', gross_amount: '1.00' } });
    expect(
      (await createDriver('midtrans', ctx(creds, cheap)).confirmReturn({ order_id: 'MID_X_1' }, o))
        .error,
    ).toBe('midtrans_amount_mismatch');
    const pend = routes({ '/status': { transaction_status: 'pending' } });
    expect(
      (await createDriver('midtrans', ctx(creds, pend)).confirmReturn({ order_id: 'MID_X_1' }, o))
        .status,
    ).toBe('pending');
    const deny = routes({ '/status': { transaction_status: 'deny' } });
    expect(
      (await createDriver('midtrans', ctx(creds, deny)).confirmReturn({ order_id: 'MID_X_1' }, o))
        .error,
    ).toBe('midtrans_status: deny');
  });

  it('accepts a webhook only with the sha512 signature_key and finalises by order id', async () => {
    const d = createDriver('midtrans', ctx(creds, never));
    const n = {
      order_id: 'MID_X_1',
      status_code: '200',
      gross_amount: '150000.00',
      transaction_status: 'settlement',
      transaction_id: 'T1',
    };
    const sig = sha('sha512', `MID_X_1200150000.00SB-key`);
    expect(await d.verifyWebhook(json({ ...n, signature_key: sig }), {})).toBe(true);
    expect(await d.verifyWebhook(json({ ...n, signature_key: 'x'.repeat(128) }), {})).toBe(false);
    expect(await d.verifyWebhook(json(n), {})).toBe(false);
    expect(d.parseWebhook(n)).toMatchObject({
      gatewayOrderId: 'MID_X_1',
      gatewayPaymentId: 'T1',
      amountMinor: 15000000n,
    });
    expect(d.parseWebhook({ ...n, transaction_status: 'deny' })).toBeNull();
    expect(
      d.parseWebhook({ ...n, transaction_status: 'capture', fraud_status: 'challenge' }),
    ).toBeNull();
  });
});

describe('Duitku (TW-PAYGW-023)', () => {
  const creds = { merchant_code: 'D123', api_key: 'KEY' };
  it('signs the invoice request, refuses amounts under 1 and sends the return URL with the merchant order id', async () => {
    const http = routes({
      '/createInvoice': { statusCode: '00', paymentUrl: 'https://duitku.test/pay' },
    });
    const d = createDriver('duitku', ctx(creds, http));
    const r = await d.initiate(idr, urls);
    expect(r).toMatchObject({ status: 'pending', redirectUrl: 'https://duitku.test/pay' });
    expect(r.gatewayOrderId).toMatch(/^DTKWSN-261005-ABC123-\d{6}$/);
    const [, init] = callTo(http, 'createInvoice');
    const sent = JSON.parse(String(init.body));
    expect(sent.paymentAmount).toBe(150000);
    expect(sent.expiryPeriod).toBe(60);
    expect(sent.returnUrl).toContain(`merchantOrderId=${r.gatewayOrderId}`);
    expect(sent.callbackUrl).toBe(urls.notifyUrl);
    expect(init.headers!['x-duitku-signature']).toBe(
      sha('sha256', `D123${init.headers!['x-duitku-timestamp']}KEY`),
    );
    expect((await d.initiate({ ...idr, amountMajor: '0.00', amountMinor: 0n }, urls)).error).toBe(
      'duitku_invalid_amount',
    );
  });

  it('finalises from a valid md5 notification (resultCode 00) by merchantOrderId, and rejects a bad one', async () => {
    const d = createDriver('duitku', ctx(creds, never));
    const n = { merchantOrderId: 'DTK1', amount: '150000', resultCode: '00', reference: 'R1' };
    const signed = { ...n, signature: md5('D123150000DTK1KEY') };
    expect(await d.verifyWebhook(form(signed), {})).toBe(true);
    expect(await d.verifyWebhook(form({ ...signed, amount: '1' }), {})).toBe(false);
    expect(await d.verifyWebhook(form(n), {})).toBe(false);
    expect(d.parseWebhook(signed)).toMatchObject({
      gatewayOrderId: 'DTK1',
      gatewayPaymentId: 'R1',
      amountMinor: 15000000n,
    });
    expect(d.parseWebhook({ ...signed, resultCode: '01' })).toBeNull();
  });

  it('the return checks the status with a signed call, for our order and amount', async () => {
    const http = routes({
      '/transactionStatus': { statusCode: '00', reference: 'R9', amount: '150000' },
    });
    const d = createDriver('duitku', ctx(creds, http));
    const o = { ...idr, gatewayOrderId: 'DTK1' };
    expect(await d.confirmReturn({ merchantOrderId: 'DTK1' }, o)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'R9',
    });
    expect(JSON.parse(String(callTo(http, 'transactionStatus')[1].body)).signature).toBe(
      md5('D123DTK1KEY'),
    );
    expect((await d.confirmReturn({ merchantOrderId: 'DTK2' }, o)).error).toBe(
      'duitku_order_mismatch',
    );
    const open = routes({ '/transactionStatus': { statusCode: '01' } });
    expect(
      (await createDriver('duitku', ctx(creds, open)).confirmReturn({ merchantOrderId: 'DTK1' }, o))
        .status,
    ).toBe('pending');
  });
});

describe('Xendit (TW-PAYGW-023)', () => {
  const creds = { secret_key: 'xnd', public_key: 'pk', webhook_token: 'tok' };
  it('creates an invoice with our external id on the success URL and checks the return by external id', async () => {
    const http = routes({
      '/v2/invoices': (i: Init) =>
        i.method === 'POST'
          ? { id: 'inv1', invoice_url: 'https://checkout.xendit.test/inv1' }
          : [{ id: 'inv1', status: 'PAID', paid_amount: 150000, currency: 'IDR' }],
    });
    const d = createDriver('xendit', ctx(creds, http));
    const r = await d.initiate(idr, urls);
    expect(r).toMatchObject({
      status: 'pending',
      redirectUrl: 'https://checkout.xendit.test/inv1',
      gatewayOrderId: 'inv1',
    });
    const sent = JSON.parse(String(http.mock.calls[0]![1].body));
    expect(sent.external_id).toMatch(/^WSN-261005-ABC123_\d+$/);
    expect(sent.success_redirect_url).toContain(`xendit_ext=${sent.external_id}`);
    expect(await d.confirmReturn({ xendit_ext: sent.external_id }, idr)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'inv1',
    });
    expect((await d.confirmReturn({ xendit_ext: 'OTHER_1' }, idr)).error).toBe(
      'xendit_reference_mismatch',
    );
    expect((await d.confirmReturn({ status: 'failed' }, idr)).error).toBe('xendit_failed');
    expect((await d.confirmReturn({}, idr)).status).toBe('pending');
  });

  it('accepts a notification only with the static callback token and derives the order from the external id', async () => {
    const d = createDriver('xendit', ctx(creds, never));
    expect(await d.verifyWebhook(json({}), { 'x-callback-token': 'tok' })).toBe(true);
    expect(await d.verifyWebhook(json({}), { 'x-callback-token': 'nope' })).toBe(false);
    expect(await d.verifyWebhook(json({}), {})).toBe(false);
    expect(
      await createDriver('xendit', ctx({ ...creds, webhook_token: '' }, never)).verifyWebhook(
        json({}),
        { 'x-callback-token': '' },
      ),
    ).toBe(false);
    expect(
      d.parseWebhook({
        status: 'PAID',
        id: 'inv1',
        external_id: 'WSN-261005-ABC123_1700000000',
        paid_amount: 150000,
        currency: 'IDR',
      }),
    ).toMatchObject({
      orderNumber: 'WSN-261005-ABC123',
      gatewayOrderId: 'inv1',
      amountMinor: 15000000n,
    });
    expect(d.parseWebhook({ status: 'EXPIRED' })).toBeNull();
  });
});

describe('Tap (TW-PAYGW-023)', () => {
  const creds = { secret_key: 'sk_test', publishable_key: 'pk' };
  const captured = {
    id: 'chg_1',
    status: 'CAPTURED',
    amount: 46.02,
    currency: 'USD',
    reference: { order: order.orderNumber },
  };
  it('creates a charge with our reference and the notify URL', async () => {
    const http = routes({
      '/charges': { id: 'chg_1', transaction: { url: 'https://tap.test/pay' } },
    });
    const r = await createDriver('tap', ctx(creds, http)).initiate(order, urls);
    expect(r).toMatchObject({
      status: 'pending',
      redirectUrl: 'https://tap.test/pay',
      gatewayOrderId: 'chg_1',
    });
    const sent = JSON.parse(String(http.mock.calls[0]![1].body));
    expect(sent).toMatchObject({
      amount: 46.02,
      currency: 'USD',
      reference: { order: order.orderNumber },
      post: { url: urls.notifyUrl },
    });
  });

  it('a return is paid only when Tap says CAPTURED for THIS order and amount', async () => {
    const d = createDriver('tap', ctx(creds, routes({ '/charges/chg_1': captured })));
    expect(await d.confirmReturn({ tap_id: 'chg_1' }, order)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'chg_1',
    });
    const other = routes({ '/charges/chg_1': { ...captured, reference: { order: 'WSN-OTHER' } } });
    expect(
      (await createDriver('tap', ctx(creds, other)).confirmReturn({ tap_id: 'chg_1' }, order))
        .error,
    ).toBe('tap_reference_mismatch');
    const cheap = routes({ '/charges/chg_1': { ...captured, amount: 1 } });
    expect(
      (await createDriver('tap', ctx(creds, cheap)).confirmReturn({ tap_id: 'chg_1' }, order))
        .error,
    ).toBe('tap_amount_mismatch');
    const declined = routes({ '/charges/chg_1': { ...captured, status: 'DECLINED' } });
    expect(
      (await createDriver('tap', ctx(creds, declined)).confirmReturn({ tap_id: 'chg_1' }, order))
        .error,
    ).toBe('tap_status: DECLINED');
    expect((await d.confirmReturn({}, order)).error).toBe('missing_tap_charge_id');
  });

  it('a notification is read back from Tap: a forged body naming another order changes nothing', async () => {
    const d = createDriver('tap', ctx(creds, routes({ '/charges/chg_1': captured })));
    const forged = { id: 'chg_1', reference: { order: 'WSN-EXPENSIVE' }, amount: 9999 };
    expect(await d.verifyWebhook(json(forged), {})).toBe(true);
    expect(d.parseWebhook(forged)).toMatchObject({
      orderNumber: order.orderNumber,
      amountMinor: 4602n,
      currency: 'USD',
    });
    const unpaid = createDriver(
      'tap',
      ctx(creds, routes({ '/charges/chg_2': { ...captured, id: 'chg_2', status: 'INITIATED' } })),
    );
    expect(await unpaid.verifyWebhook(json({ id: 'chg_2' }), {})).toBe(false);
    expect(unpaid.parseWebhook({ id: 'chg_2' })).toBeNull();
    expect(await d.verifyWebhook(json({}), {})).toBe(false);
  });
});

describe('HyperPay (TW-PAYGW-023)', () => {
  const creds = { access_token: 'tok', entity_id: 'ent' };
  it('prepares a checkout and hands the browser the widget script and our return URL', async () => {
    const http = routes({ '/v1/checkouts': { id: 'CHK1' } });
    const r = await createDriver('hyperpay', ctx(creds, http)).initiate(order, urls);
    expect(r).toMatchObject({ status: 'pending', gatewayOrderId: 'CHK1' });
    expect(r.clientAction).toEqual({
      provider: 'hyperpay',
      params: {
        scriptUrl: 'https://eu-test.oppwa.com/v1/paymentWidgets.js?checkoutId=CHK1',
        returnUrl: urls.returnUrl,
        brands: 'VISA MASTER AMEX MADA',
      },
    });
    const sent = new URLSearchParams(String(http.mock.calls[0]![1].body));
    expect(sent.get('amount')).toBe('46.02');
    expect(sent.get('merchantTransactionId')).toBe(order.orderNumber);
    expect(sent.get('paymentType')).toBe('DB');
  });

  it('reads the result only from our own checkout path and classifies the result code', async () => {
    const o = { ...order, gatewayOrderId: 'CHK1' };
    const ok = routes({
      '/v1/checkouts/CHK1/payment': {
        id: 'P1',
        result: { code: '000.100.110' },
        merchantTransactionId: order.orderNumber,
        amount: '46.02',
        currency: 'USD',
      },
    });
    const d = createDriver('hyperpay', ctx(creds, ok));
    expect(await d.confirmReturn({ resourcePath: '/v1/checkouts/CHK1/payment' }, o)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'P1',
    });
    expect((await d.confirmReturn({ resourcePath: '/v1/checkouts/OTHER/payment' }, o)).error).toBe(
      'hyperpay_resource_mismatch',
    );
    expect((await d.confirmReturn({ resourcePath: 'https://evil.test/x' }, o)).error).toBe(
      'hyperpay_resource_mismatch',
    );
    expect((await d.confirmReturn({}, o)).error).toBe('missing_hyperpay_resource_path');
    const wait = routes({ '/payment': { id: 'P1', result: { code: '000.600.000' } } });
    expect(
      (
        await createDriver('hyperpay', ctx(creds, wait)).confirmReturn(
          { resourcePath: '/v1/checkouts/CHK1/payment' },
          o,
        )
      ).status,
    ).toBe('pending');
    const bad = routes({
      '/payment': { id: 'P1', result: { code: '800.100.153', description: 'declined' } },
    });
    expect(
      (
        await createDriver('hyperpay', ctx(creds, bad)).confirmReturn(
          { resourcePath: '/v1/checkouts/CHK1/payment' },
          o,
        )
      ).error,
    ).toBe('hyperpay: declined');
    const wrongRef = routes({
      '/payment': {
        id: 'P1',
        result: { code: '000.000.000' },
        merchantTransactionId: 'WSN-OTHER',
        amount: '46.02',
        currency: 'USD',
      },
    });
    expect(
      (
        await createDriver('hyperpay', ctx(creds, wrongRef)).confirmReturn(
          { resourcePath: '/v1/checkouts/CHK1/payment' },
          o,
        )
      ).error,
    ).toBe('hyperpay_reference_mismatch');
    expect(await d.verifyWebhook(json({}), {})).toBe(false);
  });
});

describe('SSLCommerz (TW-PAYGW-023)', () => {
  const creds = { store_id: 'sid', store_password: 'spw' };
  const bdt: DriverOrder = {
    ...order,
    currency: 'BDT',
    amountMajor: '4602.00',
    amountMinor: 460200n,
  };
  it('starts a session carrying our order number, and validates the return through the validator API', async () => {
    const http = routes({
      '/gwprocess/v4/api.php': { status: 'SUCCESS', GatewayPageURL: 'https://sslcommerz.test/pay' },
    });
    const d = createDriver('sslcommerz', ctx(creds, http));
    const r = await d.initiate(bdt, urls);
    expect(r).toMatchObject({ status: 'pending', redirectUrl: 'https://sslcommerz.test/pay' });
    const sent = new URLSearchParams(String(http.mock.calls[0]![1].body));
    expect(sent.get('value_a')).toBe(bdt.orderNumber);
    expect(sent.get('total_amount')).toBe('4602.00');
    expect(sent.get('tran_id')).toBe(r.gatewayOrderId);

    const o = { ...bdt, gatewayOrderId: 'SSL_1' };
    const val = routes({
      '/validationserverAPI.php': {
        status: 'VALID',
        tran_id: 'SSL_1',
        amount: '4602.00',
        currency_type: 'BDT',
      },
    });
    const v = createDriver('sslcommerz', ctx(creds, val));
    expect(await v.confirmReturn({ val_id: 'V1', status: 'VALID' }, o)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'V1',
    });
    expect((await v.confirmReturn({ status: 'cancelled' }, o)).error).toBe('cancelled_by_user');
    expect((await v.confirmReturn({ status: 'failed' }, o)).error).toBe('sslcommerz_failed');
    expect((await v.confirmReturn({}, o)).error).toBe('missing_sslcommerz_val_id');
    const wrongTxn = routes({
      '/validationserverAPI.php': {
        status: 'VALID',
        tran_id: 'SSL_OTHER',
        amount: '4602.00',
        currency_type: 'BDT',
      },
    });
    expect(
      (await createDriver('sslcommerz', ctx(creds, wrongTxn)).confirmReturn({ val_id: 'V1' }, o))
        .error,
    ).toBe('sslcommerz_transaction_mismatch');
    const cheap = routes({
      '/validationserverAPI.php': {
        status: 'VALID',
        tran_id: 'SSL_1',
        amount: '1.00',
        currency_type: 'BDT',
      },
    });
    expect(
      (await createDriver('sslcommerz', ctx(creds, cheap)).confirmReturn({ val_id: 'V1' }, o))
        .error,
    ).toBe('sslcommerz_amount_mismatch');
  });

  it('verifies the IPN signature (md5 over verify_key fields + md5 of the store password)', async () => {
    const d = createDriver('sslcommerz', ctx(creds, never));
    const f: Record<string, string> = {
      status: 'VALID',
      tran_id: 'SSL_1',
      val_id: 'V1',
      amount: '4602.00',
      currency_type: 'BDT',
      value_a: 'WSN-X',
      verify_key: 'status,tran_id,val_id,amount',
    };
    const sign = sslcommerzSign(f, 'spw');
    expect(sign).toBe(
      md5(`amount=4602.00&status=VALID&tran_id=SSL_1&val_id=V1&store_passwd=${md5('spw')}`),
    );
    expect(await d.verifyWebhook(form({ ...f, verify_sign: sign }), {})).toBe(true);
    expect(await d.verifyWebhook(form({ ...f, amount: '1.00', verify_sign: sign }), {})).toBe(
      false,
    );
    expect(await d.verifyWebhook(form(f), {})).toBe(false);
    expect(d.parseWebhook(f)).toMatchObject({
      orderNumber: 'WSN-X',
      gatewayOrderId: 'SSL_1',
      gatewayPaymentId: 'V1',
      amountMinor: 460200n,
    });
    expect(d.parseWebhook({ ...f, status: 'FAILED' })).toBeNull();
  });
});

describe('iyzico (TW-PAYGW-024)', () => {
  const creds = { api_key: 'api', secret_key: 'sec' };
  const tryOrder: DriverOrder = { ...order, currency: 'TRY', amountMajor: '46.02' };
  it('builds the PKI string with nested objects and lists in brackets', () => {
    expect(iyzicoPki({ a: '1', b: { c: '2', d: 'x' }, e: [1], f: [{ g: 'h' }] })).toBe(
      '[a=1, b=[c=2, d=x], e=[1], f=[[g=h]]]',
    );
  });

  it('initiates with an IYZWS authorization of sha1(api + rnd + secret + pki) and returns the payment page', async () => {
    const http = routes({
      '/initialize/auth/ecom': {
        status: 'success',
        paymentPageUrl: 'https://iyzico.test/p',
        token: 'tok1',
      },
    });
    const r = await createDriver('iyzico', ctx(creds, http)).initiate(tryOrder, urls);
    expect(r).toMatchObject({
      status: 'pending',
      redirectUrl: 'https://iyzico.test/p',
      gatewayOrderId: 'tok1',
    });
    const [url, init] = http.mock.calls[0]!;
    expect(url).toContain('sandbox-api.iyzipay.com');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      price: '46.02',
      paidPrice: '46.02',
      currency: 'TRY',
      basketId: order.orderNumber,
      enabledInstallments: [1],
    });
    const rnd = init.headers!['x-iyzi-rnd']!;
    const expected = createHash('sha1')
      .update(`api${rnd}sec${iyzicoPki(body)}`)
      .digest('base64');
    expect(init.headers!.Authorization).toBe(`IYZWS api:${expected}`);
  });

  it('confirms through the form detail for our token, basket and amount; there is no notification', async () => {
    const o = { ...tryOrder, gatewayOrderId: 'tok1' };
    const ok = routes({
      '/auth/ecom/detail': {
        status: 'success',
        paymentStatus: 'SUCCESS',
        paymentId: 'P1',
        basketId: order.orderNumber,
        paidPrice: 46.02,
        currency: 'TRY',
      },
    });
    const d = createDriver('iyzico', ctx(creds, ok));
    expect(await d.confirmReturn({ token: 'tok1' }, o)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'P1',
    });
    expect((await d.confirmReturn({ token: 'other' }, o)).error).toBe('iyzico_token_mismatch');
    expect((await d.confirmReturn({}, o)).error).toBe('missing_iyzico_token');
    const wrong = routes({
      '/auth/ecom/detail': {
        status: 'success',
        paymentStatus: 'SUCCESS',
        basketId: 'WSN-OTHER',
        paidPrice: 46.02,
        currency: 'TRY',
      },
    });
    expect(
      (await createDriver('iyzico', ctx(creds, wrong)).confirmReturn({ token: 'tok1' }, o)).error,
    ).toBe('iyzico_reference_mismatch');
    const fail = routes({ '/auth/ecom/detail': { status: 'failure', errorMessage: 'declined' } });
    expect(
      (await createDriver('iyzico', ctx(creds, fail)).confirmReturn({ token: 'tok1' }, o)).error,
    ).toBe('iyzico: declined');
    expect(await d.verifyWebhook(json({}), {})).toBe(false);
  });
});

describe('PayTR (TW-PAYGW-024)', () => {
  const creds = { merchant_id: 'M1', merchant_key: 'KEY', merchant_salt: 'SALT' };
  const tryOrder: DriverOrder = { ...order, currency: 'TRY' };
  it('requests a token with the documented HMAC over the ordered fields and opens the secure page', async () => {
    const http = routes({ '/get-token': { status: 'success', token: 'TKN' } });
    const r = await createDriver('paytr', ctx(creds, http)).initiate(tryOrder, urls);
    expect(r).toMatchObject({
      status: 'pending',
      redirectUrl: 'https://www.paytr.com/odeme/guvenli/TKN',
    });
    const f = new URLSearchParams(String(http.mock.calls[0]![1].body));
    expect(f.get('payment_amount')).toBe('4602');
    expect(f.get('currency')).toBe('TL');
    const hashStr = `M1${f.get('user_ip')}${f.get('merchant_oid')}buyer@example.com4602${f.get('user_basket')}10TL1`;
    expect(f.get('paytr_token')).toBe(
      createHmac('sha256', 'KEY').update(`${hashStr}SALT`).digest('base64'),
    );
    expect(r.gatewayOrderId).toBe(f.get('merchant_oid'));
  });

  it('verifies the notification hash, finalises by merchant_oid, and a return asks the order inquiry instead of trusting the redirect', async () => {
    const d = createDriver('paytr', ctx(creds, never));
    const n = {
      merchant_oid: 'PAYTR_X_1',
      status: 'success',
      total_amount: '4602',
      payment_amount: '4602',
    };
    const hash = paytrNotificationHash(n, 'KEY', 'SALT');
    expect(hash).toBe(
      createHmac('sha256', 'KEY').update('PAYTR_X_1SALTsuccess4602').digest('base64'),
    );
    expect(await d.verifyWebhook(form({ ...n, hash }), {})).toBe(true);
    expect(await d.verifyWebhook(form({ ...n, status: 'failed', hash }), {})).toBe(false);
    expect(await d.verifyWebhook(form(n), {})).toBe(false);
    expect(d.parseWebhook(n)).toMatchObject({ gatewayOrderId: 'PAYTR_X_1', amountMinor: 4602n });
    expect(d.parseWebhook({ ...n, status: 'failed' })).toBeNull();

    const o = { ...tryOrder, gatewayOrderId: 'PAYTR_X_1' };
    const inq = routes({ '/durum-sorgu': { status: 'success', payment_amount: '4602' } });
    expect(
      await createDriver('paytr', ctx(creds, inq)).confirmReturn({ status: 'success' }, o),
    ).toMatchObject({ status: 'paid' });
    expect((await d.confirmReturn({ status: 'failed' }, o)).error).toBe('paytr_failed');
    const none = routes({ '/durum-sorgu': { status: 'error', err_no: '6' } });
    expect(
      (await createDriver('paytr', ctx(creds, none)).confirmReturn({ status: 'success' }, o))
        .status,
    ).toBe('pending');
    const cheap = routes({ '/durum-sorgu': { status: 'success', payment_amount: '100' } });
    expect(
      (await createDriver('paytr', ctx(creds, cheap)).confirmReturn({ status: 'success' }, o))
        .error,
    ).toBe('paytr_amount_mismatch');
  });
});

describe('Fondy (TW-PAYGW-024)', () => {
  const creds = { merchant_id: '1396424', payment_key: 'test' };
  it('signs the checkout request (sha1 over key and sorted non-empty values)', async () => {
    const http = routes({
      '/checkout/url/': {
        response: { response_status: 'success', checkout_url: 'https://fondy.test/c' },
      },
    });
    const r = await createDriver('fondy', ctx(creds, http)).initiate(order, urls);
    expect(r).toMatchObject({ status: 'pending', redirectUrl: 'https://fondy.test/c' });
    const req = JSON.parse(String(http.mock.calls[0]![1].body)).request;
    expect(req.amount).toBe(4602);
    expect(req.signature).toBe(fondySign({ ...req, signature: undefined }, 'test'));
    expect(fondySign({ b: '2', a: '1', c: '' }, 'k')).toBe(sha('sha1', 'k|1|2'));
  });

  it('pays a signed approved return for our order and amount; a bad or missing signature is refused; the callback finalises by order id', async () => {
    const d = createDriver('fondy', ctx(creds, never));
    const o = { ...order, gatewayOrderId: 'FONDY_X_1' };
    const f: Record<string, string> = {
      order_id: 'FONDY_X_1',
      order_status: 'approved',
      payment_id: '77',
      amount: '4602',
      currency: 'USD',
    };
    const signed = { ...f, signature: fondySign(f, 'test') };
    expect(await d.confirmReturn(signed, o)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: '77',
    });
    expect((await d.confirmReturn({ ...signed, amount: '1' }, o)).error).toBe(
      'fondy_signature_invalid',
    );
    expect((await d.confirmReturn(f, o)).error).toBe('fondy_signature_invalid');
    const otherOrder = { ...f, order_id: 'FONDY_OTHER' };
    expect(
      (await d.confirmReturn({ ...otherOrder, signature: fondySign(otherOrder, 'test') }, o)).error,
    ).toBe('fondy_order_mismatch');
    const declined = { ...f, order_status: 'declined' };
    expect(
      (await d.confirmReturn({ ...declined, signature: fondySign(declined, 'test') }, o)).error,
    ).toBe('fondy_status: declined');
    const cheap = { ...f, amount: '100' };
    expect(
      (await d.confirmReturn({ ...cheap, signature: fondySign(cheap, 'test') }, o)).error,
    ).toBe('fondy_amount_mismatch');
    expect(await d.verifyWebhook(json(signed), {})).toBe(true);
    expect(await d.verifyWebhook(json({ ...signed, amount: '5' }), {})).toBe(false);
    expect(d.parseWebhook(signed)).toMatchObject({
      gatewayOrderId: 'FONDY_X_1',
      amountMinor: 4602n,
      currency: 'USD',
    });
  });
});

describe('Skrill (TW-PAYGW-024)', () => {
  const creds = { merchant_id: 'merchant@x.test', secret_word: 'secret' };
  it('posts a form with our transaction id and order number; the return never marks it paid', async () => {
    const d = createDriver('skrill', ctx(creds, never));
    const r = await d.initiate(order, urls);
    expect(r.status).toBe('pending');
    expect(r.formPost!.url).toBe('https://pay.skrill.com');
    expect(r.formPost!.fields).toMatchObject({
      pay_to_email: 'merchant@x.test',
      amount: '46.02',
      currency: 'USD',
      order_number: order.orderNumber,
      status_url: urls.notifyUrl,
      transaction_id: r.gatewayOrderId,
    });
    expect((await d.confirmReturn({ status: 'success' }, order)).status).toBe('pending');
    expect((await d.confirmReturn({ status: 'cancelled' }, order)).error).toBe('cancelled_by_user');
  });

  it('confirms through the md5sig status notification, matched by transaction id, only when the signed amount is in our currency', async () => {
    const d = createDriver('skrill', ctx(creds, never));
    const base = {
      transaction_id: 'WSN-X_1',
      mb_transaction_id: 'MB1',
      mb_amount: '46.02',
      mb_currency: 'USD',
      status: '2',
      merchant_id: 'merchant@x.test',
      order_number: 'WSN-X',
    };
    const md5sig = skrillSignature(
      {
        merchant: 'merchant@x.test',
        transaction_id: 'WSN-X_1',
        mb_amount: '46.02',
        mb_currency: 'USD',
        status: '2',
      },
      'secret',
    );
    expect(md5sig).toBe(
      md5(`merchant@x.testWSN-X_1${md5('secret').toUpperCase()}46.02USD2`).toUpperCase(),
    );
    expect(await d.verifyWebhook(form({ ...base, md5sig }), {})).toBe(true);
    expect(await d.verifyWebhook(form({ ...base, mb_amount: '1.00', md5sig }), {})).toBe(false);
    expect(await d.verifyWebhook(form(base), {})).toBe(false);
    expect(d.parseWebhook(base)).toMatchObject({
      orderNumber: 'WSN-X',
      gatewayOrderId: 'WSN-X_1',
      gatewayPaymentId: 'MB1',
      amountMinor: 4602n,
      currency: 'USD',
    });
    expect(d.parseWebhook({ ...base, status: '0' })).toBeNull();
  });
});

describe('2Checkout (TW-PAYGW-024)', () => {
  const creds = { merchant_code: 'M1', secret_key: 'SK', buy_link_secret: 'BLS' };
  const now = new Date('2026-10-05T10:00:00Z');
  it('builds a signed Buy Link with our reference and a one hour expiry', async () => {
    const d = new TwocheckoutDriver(ctx(creds, never), () => now);
    const r = await d.initiate(order, urls);
    const u = new URL(r.redirectUrl!);
    expect(u.origin + u.pathname).toBe('https://secure.2checkout.com/checkout/buy');
    expect(u.searchParams.get('order-ext-ref')).toBe(order.orderNumber);
    expect(u.searchParams.get('price')).toBe('46.02');
    expect(u.searchParams.get('expiration')).toBe('2026-10-05 11:00:00');
    const len = (s: string) => `${s.length}${s}`;
    expect(u.searchParams.get('signature')).toBe(
      createHmac('sha256', 'BLS')
        .update(['M1', '2026-10-05 10:00:00', '46.02', 'USD', order.orderNumber].map(len).join(''))
        .digest('hex'),
    );
  });

  it('confirms a return through the REST order (our external reference, status, amount) and verifies the IPN hash', async () => {
    const http = routes({
      '/rest/6.0/orders/123/': {
        Status: 'COMPLETE',
        ExternalReference: order.orderNumber,
        Currency: 'USD',
        NetPrice: '46.02',
      },
    });
    const d = new TwocheckoutDriver(ctx(creds, http), () => now);
    expect(await d.confirmReturn({ refno: '123' }, order)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: '123',
    });
    const hdr = callTo(http, 'orders/123')[1].headers!['X-Avangate-Authentication']!;
    expect(hdr).toBe(
      `code="M1" date="2026-10-05 10:00:00" hash="${createHmac('md5', 'SK').update('2M1192026-10-05 10:00:00').digest('hex')}"`,
    );
    expect((await d.confirmReturn({}, order)).error).toBe('missing_twocheckout_refno');
    const other = routes({
      '/orders/123/': { Status: 'COMPLETE', ExternalReference: 'WSN-OTHER', NetPrice: '46.02' },
    });
    expect(
      (
        await new TwocheckoutDriver(ctx(creds, other), () => now).confirmReturn(
          { refno: '123' },
          order,
        )
      ).error,
    ).toBe('twocheckout_reference_mismatch');
    const cheap = routes({
      '/orders/123/': {
        Status: 'COMPLETE',
        ExternalReference: order.orderNumber,
        NetPrice: '1.00',
        GrossPrice: '1.00',
      },
    });
    expect(
      (
        await new TwocheckoutDriver(ctx(creds, cheap), () => now).confirmReturn(
          { refno: '123' },
          order,
        )
      ).error,
    ).toBe('twocheckout_amount_mismatch');
    const pend = routes({ '/orders/123/': { Status: 'PENDING' } });
    expect(
      (
        await new TwocheckoutDriver(ctx(creds, pend), () => now).confirmReturn(
          { refno: '123' },
          order,
        )
      ).status,
    ).toBe('pending');

    const ipn = { REFNO: '123', REFNOEXT: order.orderNumber, ORDERSTATUS: 'COMPLETE' };
    const text = Object.values(ipn)
      .map((v) => `${v.length}${v}`)
      .join('');
    const HASH = createHmac('md5', 'SK').update(text).digest('hex');
    expect(await d.verifyWebhook(form({ ...ipn, HASH }))).toBe(true);
    expect(await d.verifyWebhook(form({ ...ipn, REFNOEXT: 'WSN-X', HASH }))).toBe(false);
    expect(await d.verifyWebhook(form(ipn))).toBe(false);
    expect(d.parseWebhook(ipn)).toMatchObject({
      orderNumber: order.orderNumber,
      gatewayPaymentId: '123',
    });
    expect(d.parseWebhook({ ...ipn, ORDERSTATUS: 'PENDING' })).toBeNull();
  });
});

describe('Coinbase Commerce (TW-PAYGW-024)', () => {
  const creds = { api_key: 'key', webhook_secret: 'whsec' };
  it('creates a fixed-price charge; the return stays pending, a cancel is a decline', async () => {
    const http = routes({
      '/charges': {
        data: { hosted_url: 'https://commerce.test/charges/ABC', code: 'ABC', id: 'uuid' },
      },
    });
    const d = createDriver('coinbase', ctx(creds, http));
    const r = await d.initiate(order, urls);
    expect(r).toMatchObject({
      status: 'pending',
      redirectUrl: 'https://commerce.test/charges/ABC',
      gatewayOrderId: 'ABC',
    });
    const sent = JSON.parse(String(http.mock.calls[0]![1].body));
    expect(sent).toMatchObject({
      pricing_type: 'fixed_price',
      local_price: { amount: '46.02', currency: 'USD' },
      metadata: { order_number: order.orderNumber },
    });
    expect(http.mock.calls[0]![1].headers!['X-CC-Api-Key']).toBe('key');
    expect((await d.confirmReturn({ status: 'success' }, order)).status).toBe('pending');
    expect((await d.confirmReturn({ status: 'cancelled' }, order)).error).toBe('cancelled_by_user');
  });

  it('finalises a signed charge:confirmed by the order number in its metadata; unsigned or other events are not applied', async () => {
    const d = createDriver('coinbase', ctx(creds, never));
    const body = json({
      event: {
        type: 'charge:confirmed',
        data: {
          id: 'uuid',
          code: 'ABC',
          metadata: { order_number: order.orderNumber },
          pricing: { local: { amount: '46.02', currency: 'USD' } },
        },
      },
    });
    const sig = createHmac('sha256', 'whsec').update(body).digest('hex');
    expect(await d.verifyWebhook(body, { 'x-cc-webhook-signature': sig })).toBe(true);
    expect(await d.verifyWebhook(body, { 'x-cc-webhook-signature': 'bad' })).toBe(false);
    expect(await d.verifyWebhook(body, {})).toBe(false);
    expect(
      await createDriver('coinbase', ctx({ ...creds, webhook_secret: '' }, never)).verifyWebhook(
        body,
        { 'x-cc-webhook-signature': sig },
      ),
    ).toBe(false);
    expect(d.parseWebhook(JSON.parse(body.toString()))).toMatchObject({
      orderNumber: order.orderNumber,
      gatewayOrderId: 'ABC',
      amountMinor: 4602n,
      currency: 'USD',
    });
    expect(d.parseWebhook({ event: { type: 'charge:pending', data: {} } })).toBeNull();
    expect(d.parseWebhook({ event: { type: 'charge:failed', data: {} } })).toBeNull();
  });
});

describe('Mercado Pago (TW-PAYGW-024)', () => {
  const creds = { access_token: 'APP_USR', public_key: 'pk', webhook_secret: 'ws' };
  const brl: DriverOrder = { ...order, currency: 'BRL' };
  const approved = {
    id: 555,
    status: 'approved',
    external_reference: order.orderNumber,
    transaction_amount: 46.02,
    currency_id: 'BRL',
  };
  it('creates a preference with our external reference and the sandbox or live init point', async () => {
    const http = routes({
      '/checkout/preferences': {
        id: 'pref1',
        init_point: 'https://mp.test/live',
        sandbox_init_point: 'https://mp.test/sandbox',
      },
    });
    const sandbox = await createDriver('mercadopago', ctx(creds, http)).initiate(brl, urls);
    expect(sandbox).toMatchObject({
      redirectUrl: 'https://mp.test/sandbox',
      gatewayOrderId: 'pref1',
    });
    expect(
      (await createDriver('mercadopago', ctx(creds, http, 'live')).initiate(brl, urls)).redirectUrl,
    ).toBe('https://mp.test/live');
    const sent = JSON.parse(String(http.mock.calls[0]![1].body));
    expect(sent.external_reference).toBe(order.orderNumber);
    expect(sent.items[0]).toMatchObject({ unit_price: 46.02, currency_id: 'BRL' });
    expect(sent.notification_url).toBe(urls.notifyUrl);
  });

  it('never trusts status=approved in the URL: the payment is re-read and must be ours, approved and the right amount', async () => {
    const d = createDriver('mercadopago', ctx(creds, routes({ '/v1/payments/555': approved })));
    expect(await d.confirmReturn({ status: 'approved', payment_id: '555' }, brl)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: '555',
    });
    const forgedRef = routes({
      '/v1/payments/555': { ...approved, external_reference: 'WSN-OTHER' },
    });
    expect(
      (
        await createDriver('mercadopago', ctx(creds, forgedRef)).confirmReturn(
          { status: 'approved', payment_id: '555' },
          brl,
        )
      ).error,
    ).toBe('mercadopago_reference_mismatch');
    const cheap = routes({ '/v1/payments/555': { ...approved, transaction_amount: 1 } });
    expect(
      (
        await createDriver('mercadopago', ctx(creds, cheap)).confirmReturn(
          { status: 'approved', payment_id: '555' },
          brl,
        )
      ).error,
    ).toBe('mercadopago_amount_mismatch');
    const notApproved = routes({ '/v1/payments/555': { ...approved, status: 'rejected' } });
    expect(
      (
        await createDriver('mercadopago', ctx(creds, notApproved)).confirmReturn(
          { status: 'approved', payment_id: '555' },
          brl,
        )
      ).error,
    ).toBe('mercadopago_status: rejected');
    expect((await d.confirmReturn({ status: 'approved' }, brl)).status).toBe('pending');
    expect((await d.confirmReturn({ status: 'rejected' }, brl)).error).toBe(
      'mercadopago_status: rejected',
    );
  });

  it('verifies x-signature over id, request-id and ts, then reads the payment from the API for the notification', async () => {
    const d = createDriver('mercadopago', ctx(creds, routes({ '/v1/payments/555': approved })));
    const raw = json({ type: 'payment', data: { id: '555' } });
    const ts = '1700000000';
    const v1 = createHmac('sha256', 'ws').update(`id:555;request-id:req-1;ts:${ts};`).digest('hex');
    expect(
      await d.verifyWebhook(raw, { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-1' }),
    ).toBe(true);
    expect(d.parseWebhook({ type: 'payment', data: { id: '555' } })).toMatchObject({
      orderNumber: order.orderNumber,
      gatewayPaymentId: '555',
      amountMinor: 4602n,
      currency: 'BRL',
    });
    expect(
      await d.verifyWebhook(raw, { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'other' }),
    ).toBe(false);
    expect(await d.verifyWebhook(raw, {})).toBe(false);
    const fresh = createDriver(
      'mercadopago',
      ctx(creds, routes({ '/v1/payments/555': { ...approved, status: 'pending' } })),
    );
    expect(
      await fresh.verifyWebhook(raw, {
        'x-signature': `ts=${ts},v1=${v1}`,
        'x-request-id': 'req-1',
      }),
    ).toBe(true);
    expect(fresh.parseWebhook({ type: 'payment', data: { id: '555' } })).toBeNull();
  });
});

describe('Square (TW-PAYGW-021)', () => {
  const creds = {
    application_id: 'a',
    access_token: 'tok',
    location_id: 'L1',
    webhook_signature_key: 'sigkey',
  };
  it('creates a payment link for the exact amount with our order number as the reference', async () => {
    const http = routes({
      '/online-checkout/payment-links': {
        payment_link: { url: 'https://square.test/pay', order_id: 'SQ1' },
      },
    });
    const r = await createDriver('square', ctx(creds, http)).initiate(order, urls);
    expect(r).toMatchObject({
      status: 'pending',
      redirectUrl: 'https://square.test/pay',
      gatewayOrderId: 'SQ1',
    });
    const [url, init] = http.mock.calls[0]!;
    expect(url).toContain('squareupsandbox.com');
    expect(init.headers!['Square-Version']).toBe('2024-01-18');
    const sent = JSON.parse(String(init.body));
    expect(sent.order.reference_id).toBe(order.orderNumber);
    expect(sent.order.line_items[0].base_price_money).toEqual({ amount: 4602, currency: 'USD' });
  });

  it('pays a COMPLETED order that is ours (stored id, reference, amount) with the first tender id', async () => {
    const o = { ...order, gatewayOrderId: 'SQ1' };
    const done = {
      order: {
        state: 'COMPLETED',
        reference_id: order.orderNumber,
        total_money: { amount: 4602, currency: 'USD' },
        tenders: [{ id: 'TND1' }],
      },
    };
    const d = createDriver('square', ctx(creds, routes({ '/orders/SQ1': done })));
    expect(await d.confirmReturn({ orderId: 'SQ1' }, o)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'TND1',
    });
    expect((await d.confirmReturn({ orderId: 'SQ9' }, o)).error).toBe('square_order_mismatch');
    expect((await d.confirmReturn({ transactionId: 'x' }, o)).status).toBe('pending');
    const open = routes({ '/orders/SQ1': { order: { ...done.order, state: 'OPEN' } } });
    expect(
      (await createDriver('square', ctx(creds, open)).confirmReturn({ orderId: 'SQ1' }, o)).error,
    ).toBe('square_state: OPEN');
    const cheap = routes({
      '/orders/SQ1': { order: { ...done.order, total_money: { amount: 100, currency: 'USD' } } },
    });
    expect(
      (await createDriver('square', ctx(creds, cheap)).confirmReturn({ orderId: 'SQ1' }, o)).error,
    ).toBe('square_amount_mismatch');
  });

  it('verifies the notification signature over URL + body and maps a completed payment to the order id', async () => {
    const url = 'https://api.test/v2/payments/webhook/square';
    const d = createDriver('square', ctx(creds, never, 'sandbox', url));
    const raw = json({
      type: 'payment.updated',
      data: {
        object: {
          payment: {
            id: 'PAY1',
            status: 'COMPLETED',
            order_id: 'SQ1',
            amount_money: { amount: 4602, currency: 'USD' },
          },
        },
      },
    });
    const sig = squareSignature(url, raw, 'sigkey');
    expect(sig).toBe(
      createHmac('sha256', 'sigkey')
        .update(url + raw.toString())
        .digest('base64'),
    );
    expect(await d.verifyWebhook(raw, { 'x-square-hmacsha256-signature': sig })).toBe(true);
    expect(await d.verifyWebhook(raw, { 'x-square-hmacsha256-signature': 'bad' })).toBe(false);
    expect(await d.verifyWebhook(raw, {})).toBe(false);
    expect(
      await createDriver('square', ctx(creds, never)).verifyWebhook(raw, {
        'x-square-hmacsha256-signature': sig,
      }),
    ).toBe(false);
    expect(d.parseWebhook(JSON.parse(raw.toString()))).toMatchObject({
      gatewayOrderId: 'SQ1',
      gatewayPaymentId: 'PAY1',
      amountMinor: 4602n,
      currency: 'USD',
    });
    expect(
      d.parseWebhook({
        type: 'payment.updated',
        data: { object: { payment: { status: 'APPROVED' } } },
      }),
    ).toBeNull();
  });

  it('auto-renew creates a plan, a customer and a subscription, then waits for the first invoice; renewals and cancels map to events', async () => {
    const http = routes({
      '/catalog/batch-upsert': {
        id_mappings: [{ client_object_id: '#variation', object_id: 'VAR1' }],
      },
      '/customers': { customer: { id: 'CUS1' } },
      '/subscriptions': { subscription: { id: 'SUB1', charged_through_date: '2026-11-05' } },
    });
    const d = createDriver('square', ctx(creds, http));
    expect(d.supportsRecurring?.()).toBe(true);
    const r = await d.createSubscription!(
      { ...order, recurring: { interval: 'month', count: 1 } },
      urls,
    );
    expect(r).toMatchObject({
      status: 'pending',
      redirectUrl: urls.returnUrl,
      gatewayOrderId: 'SUB1',
    });
    expect(r.payload).toMatchObject({
      gateway_subscription_id: 'SUB1',
      gateway_customer_id: 'CUS1',
      gateway_plan_id: 'VAR1',
    });
    const plan = JSON.stringify(JSON.parse(String(callTo(http, 'batch-upsert')[1].body)));
    expect(plan).toContain('"cadence":"MONTHLY"');
    expect(plan).toContain('"amount":4602');
    const ev = (b: unknown) => d.parseSubscriptionWebhook!(b);
    expect(
      ev({
        type: 'invoice.payment_made',
        data: { object: { invoice: { id: 'INV1', subscription_id: 'SUB1' } } },
      }),
    ).toEqual({ type: 'renewed', subscriptionId: 'SUB1', paymentId: 'INV1' });
    expect(
      ev({
        type: 'subscription.updated',
        data: { object: { subscription: { id: 'SUB1', status: 'CANCELED' } } },
      }),
    ).toEqual({ type: 'canceled', subscriptionId: 'SUB1' });
    expect(
      ev({
        type: 'subscription.updated',
        data: { object: { subscription: { id: 'SUB1', status: 'ACTIVE' } } },
      }),
    ).toBeNull();
    const noEmail = await d.createSubscription!({ ...order, customerEmail: null }, urls);
    expect(noEmail.error).toBe('square_customer_email_missing');
    const cancel = routes({ '/subscriptions/SUB1/cancel': {} });
    expect(
      await createDriver('square', ctx(creds, cancel)).cancelSubscription!({
        gatewaySubscriptionId: 'SUB1',
        gatewayCustomerId: null,
        gatewayPlanId: null,
      }),
    ).toEqual({ ok: true });
  });
});

describe('Braintree (TW-PAYGW-021)', () => {
  const creds = { merchant_id: 'mid', public_key: 'pub', private_key: 'priv' };
  const xml = (inner: string) => inner;
  it('issues a client token and gives the browser the Drop-in parameters with the return URL', async () => {
    const http = routes({
      '/client_token': xml('<client-token><value>ENCODED</value></client-token>'),
    });
    const r = await createDriver('braintree', ctx(creds, http)).initiate(order, urls);
    expect(r.clientAction).toEqual({
      provider: 'braintree',
      params: { clientToken: 'ENCODED', returnUrl: urls.returnUrl },
    });
    expect(http.mock.calls[0]![1].headers!.Authorization).toMatch(/^Basic /);
    const noToken = routes({ '/client_token': xml('<error/>') });
    expect((await createDriver('braintree', ctx(creds, noToken)).initiate(order, urls)).error).toBe(
      'braintree_client_token_failed',
    );
  });

  it('charges the amount WE store for the nonce on THIS order and treats settling states as paid', async () => {
    const sale = routes({
      '/transactions': xml(
        '<transaction><id>tx1</id><status>submitted_for_settlement</status><amount>46.02</amount><currency-iso-code>USD</currency-iso-code></transaction>',
      ),
    });
    const d = createDriver('braintree', ctx(creds, sale));
    expect(
      await d.confirmReturn(
        { payment_method_nonce: 'nonce-1', amount: '0.01', order_number: 'WSN-OTHER' },
        order,
      ),
    ).toMatchObject({ status: 'paid', gatewayPaymentId: 'tx1' });
    const sent = String(sale.mock.calls[0]![1].body);
    expect(sent).toContain('<amount>46.02</amount>');
    expect(sent).toContain(`<order-id>${order.orderNumber}</order-id>`);
    expect(sent).toContain('<payment-method-nonce>nonce-1</payment-method-nonce>');
    expect((await d.confirmReturn({}, order)).error).toBe('missing_braintree_nonce');
    const declined = routes({
      '/transactions': xml(
        '<api-error-response><message>Do Not Honor</message></api-error-response>',
      ),
    });
    expect(
      (
        await createDriver('braintree', ctx(creds, declined)).confirmReturn(
          { payment_method_nonce: 'n' },
          order,
        )
      ).error,
    ).toContain('braintree_status:');
  });

  it('voids and fails a sale made in another currency than the order', async () => {
    const http = routes({
      '/void': xml('<transaction><status>voided</status></transaction>'),
      '/transactions': xml(
        '<transaction><id>tx2</id><status>settled</status><amount>46.02</amount><currency-iso-code>EUR</currency-iso-code></transaction>',
      ),
    });
    const r = await createDriver('braintree', ctx(creds, http)).confirmReturn(
      { payment_method_nonce: 'n' },
      order,
    );
    expect(r.error).toBe('braintree_amount_or_currency_mismatch');
    expect(http.mock.calls.some((c) => c[0].includes('/transactions/tx2/void'))).toBe(true);
  });

  it('with a plan id an auto-renew return vaults the card and starts a subscription', async () => {
    const http = routes({
      '/customers': xml(
        '<customer><id>cust1</id><credit-card><token>tok1</token></credit-card></customer>',
      ),
      '/subscriptions': xml('<subscription><id>sub1</id><status>Active</status></subscription>'),
    });
    const d = createDriver('braintree', ctx({ ...creds, plan_id: 'planA' }, http));
    expect(d.supportsRecurring?.()).toBe(true);
    expect(createDriver('braintree', ctx(creds, never)).supportsRecurring?.()).toBe(false);
    const r = await d.confirmReturn({ payment_method_nonce: 'n' }, { ...order, isRecurring: true });
    expect(r).toMatchObject({ status: 'paid', gatewayPaymentId: 'sub1' });
    expect(r.payload).toMatchObject({
      gateway_subscription_id: 'sub1',
      gateway_customer_id: 'cust1',
    });
    const sub = String(callTo(http, '/subscriptions')[1].body);
    expect(sub).toContain('<plan-id>planA</plan-id>');
    expect(sub).toContain('<price>46.02</price>');
  });

  it('verifies the bt_signature (hmac-sha1 keyed by sha1 of the private key) and maps events; a disbursement is not a payment', async () => {
    const d = createDriver('braintree', ctx(creds, never));
    const payloadXml = (kind: string, body: string) =>
      Buffer.from(
        `<notification><kind>${kind}</kind><subject>${body}</subject></notification>`,
      ).toString('base64');
    const settled = payloadXml(
      'transaction_settled',
      '<transaction><id>tx1</id><order-id>WSN-X</order-id><amount>46.02</amount><currency-iso-code>USD</currency-iso-code></transaction>',
    );
    const sig = braintreeSignature(settled, 'priv');
    expect(sig).toBe(
      createHmac('sha1', createHash('sha1').update('priv').digest()).update(settled).digest('hex'),
    );
    const raw = form({ bt_signature: `pub|${sig}`, bt_payload: settled });
    expect(await d.verifyWebhook(raw, {})).toBe(true);
    expect(
      await d.verifyWebhook(form({ bt_signature: 'pub|deadbeef', bt_payload: settled }), {}),
    ).toBe(false);
    expect(
      await d.verifyWebhook(form({ bt_signature: `other|${sig}`, bt_payload: settled }), {}),
    ).toBe(false);
    expect(await d.verifyWebhook(form({ bt_payload: settled }), {})).toBe(false);
    expect(d.parseWebhook({ bt_payload: settled })).toMatchObject({
      orderNumber: 'WSN-X',
      gatewayPaymentId: 'tx1',
      amountMinor: 4602n,
      currency: 'USD',
    });
    expect(
      d.parseWebhook({
        bt_payload: payloadXml('disbursement', '<disbursement><id>d1</id></disbursement>'),
      }),
    ).toBeNull();
    expect(
      d.parseWebhook({
        bt_payload: payloadXml(
          'transaction_settlement_declined',
          '<transaction><id>t</id></transaction>',
        ),
      }),
    ).toBeNull();
    const ev = (kind: string) =>
      d.parseSubscriptionWebhook!({
        bt_payload: payloadXml(
          kind,
          '<subscription><id>sub1</id><transactions><transaction><id>tx9</id></transaction></transactions></subscription>',
        ),
      });
    expect(ev('subscription_charged_successfully')).toEqual({
      type: 'renewed',
      subscriptionId: 'sub1',
      paymentId: 'tx9',
    });
    expect(ev('subscription_charged_unsuccessfully')).toEqual({
      type: 'payment_failed',
      subscriptionId: 'sub1',
    });
    expect(ev('subscription_canceled')).toEqual({ type: 'canceled', subscriptionId: 'sub1' });
    expect(ev('subscription_went_active')).toBeNull();
  });
});

describe('Authorize.Net (TW-PAYGW-021)', () => {
  const creds = { api_login_id: 'login', transaction_key: 'tkey', signature_key: '00ff' };
  const bom = (o: unknown) => `\uFEFF${JSON.stringify(o)}`;
  const details = (over: Record<string, unknown> = {}) =>
    bom({
      messages: { resultCode: 'Ok' },
      transaction: {
        transactionStatus: 'settledSuccessfully',
        authAmount: 46.02,
        order: { invoiceNumber: order.orderNumber },
        ...over,
      },
    });
  it('gets a hosted page token (BOM-prefixed JSON) and posts it as a form', async () => {
    const http = routes({
      '/request.api': bom({ token: 'HOSTED', messages: { resultCode: 'Ok' } }),
    });
    const r = await createDriver('authorize_net', ctx(creds, http)).initiate(order, urls);
    expect(r.formPost).toEqual({
      url: 'https://test.authorize.net/payment/payment',
      fields: { token: 'HOSTED' },
    });
    const sent = JSON.parse(String(http.mock.calls[0]![1].body)).getHostedPaymentPageRequest;
    expect(sent.transactionRequest).toMatchObject({
      amount: '46.02',
      order: { invoiceNumber: order.orderNumber },
    });
  });

  it('a return counts only after getTransactionDetails: right invoice, amount and status; a failed lookup stays pending (not paid)', async () => {
    const d = createDriver('authorize_net', ctx(creds, routes({ '/request.api': details() })));
    expect(await d.confirmReturn({ transId: '99' }, order)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: '99',
    });
    expect((await d.confirmReturn({ cancelled: '1' }, order)).error).toBe('cancelled_by_user');
    expect((await d.confirmReturn({}, order)).status).toBe('pending');
    const lookupFails = routes({ '/request.api': bom({ messages: { resultCode: 'Error' } }) });
    expect(
      (
        await createDriver('authorize_net', ctx(creds, lookupFails)).confirmReturn(
          { transId: '99', x_response_code: '1' },
          order,
        )
      ).status,
    ).toBe('pending');
    const otherInvoice = routes({
      '/request.api': details({ order: { invoiceNumber: 'WSN-OTHER' } }),
    });
    expect(
      (
        await createDriver('authorize_net', ctx(creds, otherInvoice)).confirmReturn(
          { transId: '99' },
          order,
        )
      ).error,
    ).toBe('authorize_net_reference_mismatch');
    const cheap = routes({ '/request.api': details({ authAmount: 1 }) });
    expect(
      (
        await createDriver('authorize_net', ctx(creds, cheap)).confirmReturn(
          { transId: '99' },
          order,
        )
      ).error,
    ).toBe('authorize_net_amount_mismatch');
    const declined = routes({ '/request.api': details({ transactionStatus: 'declined' }) });
    expect(
      (
        await createDriver('authorize_net', ctx(creds, declined)).confirmReturn(
          { transId: '99' },
          order,
        )
      ).error,
    ).toBe('authorize_net_status: declined');
    const settling = routes({ '/request.api': details({ transactionStatus: 'underReview' }) });
    expect(
      (
        await createDriver('authorize_net', ctx(creds, settling)).confirmReturn(
          { transId: '99' },
          order,
        )
      ).status,
    ).toBe('pending');
  });

  it('verifies X-ANET-Signature (hmac-sha512, hex key) and reads the transaction from the API instead of the body', async () => {
    const d = createDriver('authorize_net', ctx(creds, routes({ '/request.api': details() })));
    const raw = json({
      eventType: 'net.authorize.payment.authcapture.created',
      payload: { id: '99', invoiceNumber: 'WSN-FORGED' },
    });
    const sig = createHmac('sha512', Buffer.from('00ff', 'hex'))
      .update(raw)
      .digest('hex')
      .toUpperCase();
    expect(await d.verifyWebhook(raw, { 'x-anet-signature': `sha512=${sig}` })).toBe(true);
    expect(d.parseWebhook({ payload: { id: '99' } })).toMatchObject({
      orderNumber: order.orderNumber,
      gatewayPaymentId: '99',
      amountMinor: 4602n,
    });
    expect(await d.verifyWebhook(raw, { 'x-anet-signature': 'sha512=BAD' })).toBe(false);
    expect(await d.verifyWebhook(raw, {})).toBe(false);
    expect(
      await createDriver(
        'authorize_net',
        ctx({ ...creds, signature_key: '' }, never),
      ).verifyWebhook(raw, { 'x-anet-signature': `sha512=${sig}` }),
    ).toBe(false);
  });

  it('auto-renew vaults the paid card and creates an ARB subscription; if that fails the first charge still stands', async () => {
    const arbOk = routes({
      '/request.api': (init: Init) => {
        const b = JSON.parse(String(init.body));
        if (b.getTransactionDetailsRequest) return JSON.parse(details().slice(1));
        if (b.createCustomerProfileFromTransactionRequest)
          return {
            messages: { resultCode: 'Ok' },
            customerProfileId: 'CP1',
            customerPaymentProfileIdList: ['PP1'],
          };
        return { messages: { resultCode: 'Ok' }, subscriptionId: 'ARB1' };
      },
    });
    const d = createDriver('authorize_net', ctx(creds, arbOk));
    const rec = {
      ...order,
      isRecurring: true,
      recurring: { interval: 'month' as const, count: 1 },
    };
    const r = await d.confirmReturn({ transId: '99' }, rec);
    expect(r).toMatchObject({ status: 'paid', gatewayPaymentId: '99' });
    expect(r.payload).toMatchObject({ is_subscription: true, gateway_subscription_id: 'ARB1' });
    const arbCall = arbOk.mock.calls
      .map((c) => JSON.parse(String(c[1].body)))
      .find((b) => b.ARBCreateSubscriptionRequest)!;
    expect(arbCall.ARBCreateSubscriptionRequest.subscription).toMatchObject({
      amount: '46.02',
      paymentSchedule: { interval: { length: 1, unit: 'months' }, totalOccurrences: 9999 },
    });
    const arbFails = routes({
      '/request.api': (init: Init) => {
        const b = JSON.parse(String(init.body));
        return b.getTransactionDetailsRequest
          ? JSON.parse(details().slice(1))
          : { messages: { resultCode: 'Error' } };
      },
    });
    const f = await createDriver('authorize_net', ctx(creds, arbFails)).confirmReturn(
      { transId: '99' },
      rec,
    );
    expect(f.status).toBe('paid');
    expect(f.payload).toMatchObject({ recurring_setup: 'no_profile' });
    expect(
      d.parseSubscriptionWebhook!({
        eventType: 'net.authorize.customer.subscription.cancelled',
        payload: { id: 'ARB1' },
      }),
    ).toEqual({ type: 'canceled', subscriptionId: 'ARB1' });
    expect(
      d.parseSubscriptionWebhook!({
        eventType: 'net.authorize.customer.subscription.suspended',
        payload: { id: 'ARB1' },
      }),
    ).toEqual({ type: 'payment_failed', subscriptionId: 'ARB1' });
  });
});

describe('Lemon Squeezy (TW-PAYGW-018)', () => {
  const creds = { api_key: 'k', store_id: '11', variant_id: '22', signing_secret: 'ss' };
  it('creates a checkout on the variant with the order total as the custom price and our number in the custom data', async () => {
    const http = routes({
      '/checkouts': { data: { id: 'co1', attributes: { url: 'https://ls.test/checkout/1' } } },
    });
    const r = await createDriver('lemonsqueezy', ctx(creds, http)).initiate(order, urls);
    expect(r).toMatchObject({
      status: 'pending',
      redirectUrl: 'https://ls.test/checkout/1',
      gatewayOrderId: 'co1',
    });
    const [, init] = http.mock.calls[0]!;
    expect(init.headers!['Content-Type']).toBe('application/vnd.api+json');
    const sent = JSON.parse(String(init.body)).data;
    expect(sent.attributes.custom_price).toBe(4602);
    expect(sent.attributes.checkout_data.custom.order_number).toBe(order.orderNumber);
    expect(sent.relationships).toEqual({
      store: { data: { type: 'stores', id: '11' } },
      variant: { data: { type: 'variants', id: '22' } },
    });
  });

  it('the return stays pending (Reference failed every one-time return); the signed order_created finalises it by the order number', async () => {
    const d = createDriver('lemonsqueezy', ctx(creds, never));
    expect((await d.confirmReturn({}, order)).status).toBe('pending');
    const body = json({
      meta: { event_name: 'order_created', custom_data: { order_number: order.orderNumber } },
      data: { id: '8', attributes: { status: 'paid' } },
    });
    const sig = createHmac('sha256', 'ss').update(body).digest('hex');
    expect(await d.verifyWebhook(body, { 'x-signature': sig })).toBe(true);
    expect(await d.verifyWebhook(body, { 'x-signature': 'bad' })).toBe(false);
    expect(await d.verifyWebhook(body, {})).toBe(false);
    expect(
      await createDriver(
        'lemonsqueezy',
        ctx({ ...creds, signing_secret: '' }, never),
      ).verifyWebhook(body, { 'x-signature': sig }),
    ).toBe(false);
    expect(d.parseWebhook(JSON.parse(body.toString()))).toMatchObject({
      orderNumber: order.orderNumber,
      gatewayPaymentId: '8',
    });
    expect(
      d.parseWebhook({
        meta: { event_name: 'order_created' },
        data: { attributes: { status: 'pending' } },
      }),
    ).toBeNull();
  });

  it('maps subscription events (created carries the order number, renewals only the subscription id) and cancels with DELETE', async () => {
    const d = createDriver('lemonsqueezy', ctx(creds, routes({ '/subscriptions/55': {} })));
    const ev = (b: unknown) => d.parseSubscriptionWebhook!(b);
    expect(
      ev({
        meta: { event_name: 'subscription_created', custom_data: { order_number: 'N1' } },
        data: { id: '55', attributes: { renews_at: '2026-11-05T00:00:00Z' } },
      }),
    ).toEqual({
      type: 'created',
      subscriptionId: '55',
      periodEnd: '2026-11-05T00:00:00Z',
      orderNumber: 'N1',
    });
    expect(
      ev({
        meta: { event_name: 'subscription_payment_success' },
        data: { id: 'inv9', attributes: { subscription_id: 55 } },
      }),
    ).toMatchObject({ type: 'renewed', subscriptionId: '55' });
    expect(
      ev({
        meta: { event_name: 'subscription_payment_success' },
        data: { id: 'inv9', attributes: {} },
      }),
    ).toBeNull();
    expect(
      ev({
        meta: { event_name: 'subscription_payment_success' },
        data: { id: 'inv9', attributes: { subscription_id: '55' } },
      }),
    ).toMatchObject({ type: 'renewed', subscriptionId: '55', paymentId: 'inv9' });
    expect(
      ev({ meta: { event_name: 'subscription_expired' }, data: { id: '55', attributes: {} } }),
    ).toMatchObject({ type: 'canceled', subscriptionId: '55' });
    expect(
      ev({
        meta: { event_name: 'subscription_payment_failed' },
        data: { id: 'inv9', attributes: { subscription_id: '55' } },
      }),
    ).toMatchObject({ type: 'payment_failed' });
    expect(ev({ meta: { event_name: 'something_else' }, data: {} })).toBeNull();
    expect(
      await d.cancelSubscription!({
        gatewaySubscriptionId: '55',
        gatewayCustomerId: null,
        gatewayPlanId: null,
      }),
    ).toEqual({ ok: true });
  });
});

describe('Mollie (TW-PAYGW-019)', () => {
  const creds = { api_key: 'test_key' };
  const eur: DriverOrder = { ...order, currency: 'EUR' };
  const paidPayment = {
    id: 'tr_1',
    status: 'paid',
    amount: { currency: 'EUR', value: '46.02' },
    metadata: { order_number: order.orderNumber },
  };
  it('creates a payment with the amount as a decimal string and our return URL (token included) and notify URL', async () => {
    const http = routes({
      '/payments': { id: 'tr_1', _links: { checkout: { href: 'https://mollie.test/checkout' } } },
    });
    const r = await createDriver('mollie', ctx(creds, http)).initiate(eur, urls);
    expect(r).toMatchObject({
      status: 'pending',
      redirectUrl: 'https://mollie.test/checkout',
      gatewayOrderId: 'tr_1',
    });
    const sent = JSON.parse(String(http.mock.calls[0]![1].body));
    expect(sent).toMatchObject({
      amount: { currency: 'EUR', value: '46.02' },
      redirectUrl: urls.returnUrl,
      webhookUrl: urls.notifyUrl,
      metadata: { order_number: order.orderNumber },
    });
  });

  it('the return re-reads the payment by the id WE stored, ignoring any id in the URL, and checks reference and amount', async () => {
    const o = { ...eur, gatewayOrderId: 'tr_1' };
    const http = routes({ '/payments/tr_1': paidPayment });
    const d = createDriver('mollie', ctx(creds, http));
    expect(await d.confirmReturn({ id: 'tr_attacker' }, o)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'tr_1',
    });
    expect(http.mock.calls.every((c) => !c[0].includes('attacker'))).toBe(true);
    const wrong = routes({
      '/payments/tr_1': { ...paidPayment, metadata: { order_number: 'WSN-OTHER' } },
    });
    expect((await createDriver('mollie', ctx(creds, wrong)).confirmReturn({}, o)).error).toBe(
      'mollie_reference_mismatch',
    );
    const cheap = routes({
      '/payments/tr_1': { ...paidPayment, amount: { currency: 'EUR', value: '1.00' } },
    });
    expect((await createDriver('mollie', ctx(creds, cheap)).confirmReturn({}, o)).error).toBe(
      'mollie_amount_mismatch',
    );
    const open = routes({ '/payments/tr_1': { ...paidPayment, status: 'open' } });
    expect((await createDriver('mollie', ctx(creds, open)).confirmReturn({}, o)).status).toBe(
      'pending',
    );
    const canceled = routes({ '/payments/tr_1': { ...paidPayment, status: 'canceled' } });
    expect((await createDriver('mollie', ctx(creds, canceled)).confirmReturn({}, o)).error).toBe(
      'cancelled_by_user',
    );
    expect((await d.confirmReturn({}, eur)).status).toBe('pending');
  });

  it('a notification (no signature, just an id) is accepted only when Mollie has that payment, and its data comes from Mollie', async () => {
    const d = createDriver('mollie', ctx(creds, routes({ '/payments/tr_1': paidPayment })));
    expect(await d.verifyWebhook(form({ id: 'tr_1' }), {})).toBe(true);
    expect(d.parseWebhook({ id: 'tr_1' })).toMatchObject({
      orderNumber: order.orderNumber,
      gatewayOrderId: 'tr_1',
      amountMinor: 4602n,
      currency: 'EUR',
    });
    expect(d.parseSubscriptionWebhook!({ id: 'tr_1' })).toBeNull();
    expect(await d.verifyWebhook(form({}), {})).toBe(false);
    const unknown = createDriver(
      'mollie',
      ctx(creds, routes({ '/payments/tr_9': { status: 404, title: 'Not Found' } })),
    );
    expect(await unknown.verifyWebhook(form({ id: 'tr_9' }), {})).toBe(false);
  });

  it('auto-renew: customer + first payment, then on return a subscription; a first payment is not finalised by the notification; renewals map to events', async () => {
    const http = routes({
      '/customers/cst_1/subscriptions': { id: 'sub_1', nextPaymentDate: '2026-11-05' },
      '/customers': { id: 'cst_1' },
      '/payments/tr_1': {
        ...paidPayment,
        customerId: 'cst_1',
        sequenceType: 'first',
        metadata: { order_number: order.orderNumber, recurring: '1', interval: '1 months' },
      },
      '/payments': { id: 'tr_1', _links: { checkout: { href: 'https://mollie.test/checkout' } } },
    });
    const d = createDriver('mollie', ctx(creds, http, 'sandbox', 'https://api.test/wh'));
    expect(d.supportsRecurring?.()).toBe(true);
    const start = await d.createSubscription!(
      { ...eur, recurring: { interval: 'month', count: 1 } },
      urls,
    );
    expect(start).toMatchObject({
      status: 'pending',
      gatewayOrderId: 'tr_1',
      payload: { gateway_customer_id: 'cst_1' },
    });
    const first = JSON.parse(
      String(
        http.mock.calls.find((c) => c[0].endsWith('/payments') && c[1].method === 'POST')![1].body,
      ),
    );
    expect(first).toMatchObject({
      customerId: 'cst_1',
      sequenceType: 'first',
      metadata: { recurring: '1', interval: '1 months' },
    });
    const r = await d.confirmReturn({}, { ...eur, gatewayOrderId: 'tr_1', isRecurring: true });
    expect(r).toMatchObject({ status: 'paid', gatewayPaymentId: 'tr_1' });
    expect(r.payload).toMatchObject({
      is_subscription: true,
      gateway_subscription_id: 'sub_1',
      gateway_customer_id: 'cst_1',
      current_period_end: '2026-11-05',
    });
    const subBody = JSON.parse(
      String(http.mock.calls.find((c) => c[0].includes('/subscriptions'))![1].body),
    );
    expect(subBody).toMatchObject({
      interval: '1 months',
      amount: { currency: 'EUR', value: '46.02' },
      webhookUrl: 'https://api.test/wh',
    });
    expect(await d.verifyWebhook(form({ id: 'tr_1' }), {})).toBe(true);
    expect(d.parseWebhook({ id: 'tr_1' })).toBeNull();

    const renew = routes({
      '/payments/tr_2': {
        id: 'tr_2',
        status: 'paid',
        subscriptionId: 'sub_1',
        amount: { currency: 'EUR', value: '46.02' },
        metadata: {},
      },
    });
    const rd = createDriver('mollie', ctx(creds, renew));
    expect(await rd.verifyWebhook(form({ id: 'tr_2' }), {})).toBe(true);
    expect(rd.parseSubscriptionWebhook!({ id: 'tr_2' })).toEqual({
      type: 'renewed',
      subscriptionId: 'sub_1',
      paymentId: 'tr_2',
    });
    const failedPay = routes({
      '/payments/tr_3': { id: 'tr_3', status: 'failed', subscriptionId: 'sub_1', metadata: {} },
    });
    const fd = createDriver('mollie', ctx(creds, failedPay));
    await fd.verifyWebhook(form({ id: 'tr_3' }), {});
    expect(fd.parseSubscriptionWebhook!({ id: 'tr_3' })).toMatchObject({ type: 'payment_failed' });
    const cancel = routes({ '/customers/cst_1/subscriptions/sub_1': {} });
    expect(
      await createDriver('mollie', ctx(creds, cancel)).cancelSubscription!({
        gatewaySubscriptionId: 'sub_1',
        gatewayCustomerId: 'cst_1',
        gatewayPlanId: null,
      }),
    ).toEqual({ ok: true });
    expect(
      (
        await d.cancelSubscription!({
          gatewaySubscriptionId: 'sub_1',
          gatewayCustomerId: null,
          gatewayPlanId: null,
        })
      ).reason,
    ).toBe('mollie_cancel_context_missing');
  });
});

describe('CinetPay (TW-PAYGW-025)', () => {
  const creds = { api_key: 'ak', site_id: '123', secret_key: 'sk' };
  const xof: DriverOrder = { ...order, currency: 'XOF', amountMajor: '1234', amountMinor: 1234n };
  it('rounds XOF/XAF/CDF/GNF to a multiple of 5 and leaves other currencies alone', () => {
    expect(cinetpayAmount({ amountMajor: '1234', currency: 'XOF' })).toBe(1235);
    expect(cinetpayAmount({ amountMajor: '1235', currency: 'XAF' })).toBe(1235);
    expect(cinetpayAmount({ amountMajor: '1232', currency: 'GNF' })).toBe(1230);
    expect(cinetpayAmount({ amountMajor: '1234', currency: 'USD' })).toBe(1234);
  });

  it('creates a payment with our transaction id, the rounded amount and the notify URL', async () => {
    const http = routes({
      '/v2/payment': { code: '201', data: { payment_url: 'https://cinet.test/pay' } },
    });
    const r = await createDriver('cinetpay', ctx(creds, http)).initiate(xof, urls);
    expect(r).toMatchObject({ status: 'pending', redirectUrl: 'https://cinet.test/pay' });
    expect(r.gatewayOrderId).toMatch(/^CINET-WSN-261005-ABC123-\d+$/);
    const sent = JSON.parse(String(http.mock.calls[0]![1].body));
    expect(sent).toMatchObject({
      amount: 1235,
      currency: 'XOF',
      transaction_id: r.gatewayOrderId,
      notify_url: urls.notifyUrl,
      customer_name: 'Ada',
      customer_surname: 'Buyer',
    });
    expect(
      (
        await createDriver('cinetpay', ctx(creds, never)).initiate(
          { ...xof, customerEmail: null },
          urls,
        )
      ).error,
    ).toBe('cinetpay_customer_email_missing');
  });

  it('the return and the notification both ask /payment/check for OUR transaction and accept only ACCEPTED', async () => {
    const o = { ...xof, gatewayOrderId: 'CINET-X-1' };
    const accepted = { code: '00', data: { status: 'ACCEPTED', amount: '1235', currency: 'XOF' } };
    const d = createDriver('cinetpay', ctx(creds, routes({ '/payment/check': accepted })));
    expect(await d.confirmReturn({ transaction_id: 'CINET-X-1' }, o)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'CINET-X-1',
    });
    expect((await d.confirmReturn({ transaction_id: 'CINET-OTHER' }, o)).error).toBe(
      'cinetpay_transaction_mismatch',
    );
    expect((await d.confirmReturn({}, o)).error).toBe('missing_cinetpay_tx');
    const refused = routes({ '/payment/check': { code: '00', data: { status: 'REFUSED' } } });
    expect(
      (
        await createDriver('cinetpay', ctx(creds, refused)).confirmReturn(
          { transaction_id: 'CINET-X-1' },
          o,
        )
      ).error,
    ).toBe('cinetpay_status: REFUSED');
    const waiting = routes({
      '/payment/check': { code: '00', data: { status: 'WAITING_FOR_CUSTOMER' } },
    });
    expect(
      (
        await createDriver('cinetpay', ctx(creds, waiting)).confirmReturn(
          { transaction_id: 'CINET-X-1' },
          o,
        )
      ).status,
    ).toBe('pending');
    const cheap = routes({
      '/payment/check': { code: '00', data: { status: 'ACCEPTED', amount: '5', currency: 'XOF' } },
    });
    expect(
      (
        await createDriver('cinetpay', ctx(creds, cheap)).confirmReturn(
          { transaction_id: 'CINET-X-1' },
          o,
        )
      ).error,
    ).toBe('cinetpay_amount_mismatch');

    expect(await d.verifyWebhook(form({ cpm_trans_id: 'CINET-X-1' }), {})).toBe(true);
    expect(d.parseWebhook({ cpm_trans_id: 'CINET-X-1' })).toMatchObject({
      gatewayOrderId: 'CINET-X-1',
      currency: 'XOF',
    });
    expect(await d.verifyWebhook(form({ cpm_trans_id: 'FOREIGN-1' }), {})).toBe(false);
    const unpaid = createDriver(
      'cinetpay',
      ctx(creds, routes({ '/payment/check': { code: '00', data: { status: 'REFUSED' } } })),
    );
    expect(await unpaid.verifyWebhook(form({ cpm_trans_id: 'CINET-X-2' }), {})).toBe(false);
  });
});

describe('LigdiCash (TW-PAYGW-025)', () => {
  const creds = { api_key: 'ak', api_token: 'at', store_name: 'My Store' };
  const xof: DriverOrder = { ...order, currency: 'XOF', amountMajor: '5000', amountMinor: 5000n };
  it('refuses a non-XOF order instead of relabelling it, and creates an XOF invoice with our external id', async () => {
    const d = createDriver('ligdicash', ctx(creds, never));
    expect((await d.initiate(order, urls)).error).toContain('ligdicash_currency_unsupported');
    const http = routes({
      '/checkout-invoice/create': {
        response_code: '00',
        response_text: 'https://ligdi.test/pay',
        token: 'LTOK',
      },
    });
    const r = await createDriver('ligdicash', ctx(creds, http)).initiate(xof, urls);
    expect(r).toMatchObject({
      status: 'pending',
      redirectUrl: 'https://ligdi.test/pay',
      gatewayOrderId: 'LTOK',
    });
    const [, init] = http.mock.calls[0]!;
    expect(init.headers).toMatchObject({ Apikey: 'ak', Authorization: 'Bearer at' });
    const inv = JSON.parse(String(init.body)).commande;
    expect(inv.invoice).toMatchObject({
      total_amount: 5000,
      devise: 'XOF',
      external_id: order.orderNumber,
    });
    expect(inv.actions.callback_url).toBe(urls.notifyUrl);
  });

  it('confirms by the invoice token for our order, accepting only completed; the notification is read back from LigdiCash', async () => {
    const o = { ...xof, gatewayOrderId: 'LTOK' };
    const done = {
      response_code: '00',
      status: 'completed',
      request_id: 'REQ1',
      external_id: order.orderNumber,
    };
    const d = createDriver('ligdicash', ctx(creds, routes({ '/checkout-invoice/confirm': done })));
    expect(await d.confirmReturn({ token: 'LTOK' }, o)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'REQ1',
    });
    expect((await d.confirmReturn({ token: 'OTHER' }, o)).error).toBe('ligdicash_token_mismatch');
    expect((await d.confirmReturn({}, o)).error).toBe('missing_ligdicash_token');
    const wrongRef = routes({ '/confirm': { ...done, external_id: 'WSN-OTHER' } });
    expect(
      (await createDriver('ligdicash', ctx(creds, wrongRef)).confirmReturn({ token: 'LTOK' }, o))
        .error,
    ).toBe('ligdicash_reference_mismatch');
    const pend = routes({ '/confirm': { response_code: '00', status: 'pending' } });
    expect(
      (await createDriver('ligdicash', ctx(creds, pend)).confirmReturn({ token: 'LTOK' }, o))
        .status,
    ).toBe('pending');
    expect(await d.verifyWebhook(json({ token: 'LTOK' }), {})).toBe(true);
    expect(d.parseWebhook({ token: 'LTOK', external_id: 'WSN-FORGED' })).toMatchObject({
      orderNumber: order.orderNumber,
      gatewayOrderId: 'LTOK',
      gatewayPaymentId: 'REQ1',
    });
    const unpaid = createDriver(
      'ligdicash',
      ctx(creds, routes({ '/confirm': { response_code: '00', status: 'nocompleted' } })),
    );
    expect(await unpaid.verifyWebhook(json({ token: 'LTOK' }), {})).toBe(false);
  });
});

describe('CinetPay DNS-over-HTTPS fallback (TW-PAYGW-025 rule 1), fixtures only', () => {
  const creds = { api_key: 'ak', site_id: '123' };
  const xof: DriverOrder = {
    ...order,
    currency: 'XOF',
    amountMajor: '1234',
    amountMinor: 1234n,
    customerEmail: 'a@b.test',
  };
  const dnsErr = () =>
    Object.assign(new Error('getaddrinfo ENOTFOUND'), { cause: { code: 'ENOTFOUND' } });
  const doh = (answers: Record<string, unknown>) =>
    vi.fn<HttpFetch>(async (url) => {
      const k = Object.keys(answers).find((f) => url.includes(f));
      if (!k) throw new Error('resolver down');
      return res(200, answers[k]);
    });
  const okPay = { code: '201', data: { payment_url: 'https://cinet.test/pay' } };

  it('retries against the DoH-resolved IP when local DNS fails, keeping the real host', async () => {
    const primary = vi.fn<HttpFetch>(async () => {
      throw dnsErr();
    });
    const pinned = vi.fn<PinnedFetch>(async () => res(200, okPay));
    const dohHttp = doh({ cloudflare: { Status: 0, Answer: [{ type: 1, data: '203.0.114.9' }] } });
    const r = await createDriver('cinetpay', {
      ...ctx(creds, primary),
      dohHttp,
      pinnedHttp: pinned,
    }).initiate(xof, urls);
    expect(r).toMatchObject({ status: 'pending', redirectUrl: 'https://cinet.test/pay' });
    expect(pinned.mock.calls[0]![0]).toBe('203.0.114.9');
    expect(pinned.mock.calls[0]![1]).toContain('api-checkout.cinetpay.com/v2/payment');
  });

  it('falls back to Google when Cloudflare is down, and refuses a private answer', async () => {
    const primary = async (): Promise<never> => {
      throw dnsErr();
    };
    const pinned = vi.fn<PinnedFetch>(async () => res(200, okPay));
    const dohHttp = doh({
      'dns.google': {
        Status: 0,
        Answer: [
          { type: 1, data: '10.0.0.5' },
          { type: 1, data: '203.0.114.7' },
        ],
      },
    });
    await createDriver('cinetpay', {
      ...ctx(creds, primary),
      dohHttp,
      pinnedHttp: pinned,
    }).initiate(xof, urls);
    expect(pinned.mock.calls[0]![0]).toBe('203.0.114.7');
  });

  it('reports a specific NXDOMAIN error and never pins when the name does not exist', async () => {
    const primary = async (): Promise<never> => {
      throw dnsErr();
    };
    const pinned = vi.fn<PinnedFetch>();
    const dohHttp = doh({ cloudflare: { Status: 3 }, 'dns.google': { Status: 3 } });
    const r = await createDriver('cinetpay', {
      ...ctx(creds, primary),
      dohHttp,
      pinnedHttp: pinned,
    }).initiate(xof, urls);
    expect(r.error).toContain('DNS is missing (NXDOMAIN)');
    expect(pinned).not.toHaveBeenCalled();
  });

  it('does not use DoH for an error that is not a DNS failure, and retries once', async () => {
    const primary = vi.fn<HttpFetch>(async () => {
      throw new Error('boom');
    });
    const dohHttp = vi.fn<HttpFetch>();
    const r = await createDriver('cinetpay', { ...ctx(creds, primary), dohHttp }).initiate(
      xof,
      urls,
    );
    expect(r.error).toContain('boom');
    expect(primary).toHaveBeenCalledTimes(2);
    expect(dohHttp).not.toHaveBeenCalled();
  });
});
