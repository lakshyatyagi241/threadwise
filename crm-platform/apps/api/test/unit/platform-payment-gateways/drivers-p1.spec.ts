import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createDriver,
  hasDriver,
  type DriverContext,
  type DriverOrder,
  type HttpFetch,
  type HttpResponse,
} from '../../../src/infra/providers/platform-payment-gateways';
import {
  paytmChecksum,
  paytmVerify,
} from '../../../src/infra/providers/platform-payment-gateways/india.drivers';

/**
 * P1 drivers against recorded provider answers: manual gateways, Paddle, Paystack, Flutterwave, Paytm, PhonePe, Cashfree, PayU
 * and Instamojo. No network: every call goes through the injected fetch, and every request is asserted for the exact amount, the
 * order reference and the way the provider is told to send the buyer back.
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
const inr: DriverOrder = { ...order, currency: 'INR' };
const urls = {
  returnUrl: 'https://api.test/v2/payments/return/x?o=tok',
  notifyUrl: 'https://api.test/n',
};

const res = (status: number, body: unknown): HttpResponse => ({
  status,
  json: body,
  text: typeof body === 'string' ? body : JSON.stringify(body),
});
const ctx = (
  credentials: Record<string, string>,
  http: HttpFetch,
  mode: 'sandbox' | 'live' = 'sandbox',
): DriverContext => ({
  credentials,
  mode,
  http,
});
const never: HttpFetch = async () => {
  throw new Error('no network in this test');
};
const body = (http: ReturnType<typeof vi.fn<HttpFetch>>, i = 0): string =>
  String(http.mock.calls[i]![1].body);
const hmac = (
  algo: 'sha256' | 'sha512' | 'sha1',
  secret: string,
  data: string | Buffer,
  enc: 'hex' | 'base64' = 'hex',
) => createHmac(algo, secret).update(data).digest(enc);

describe('registry', () => {
  it('has a driver for every P1 gateway', () => {
    for (const s of [
      'paddle',
      'paystack',
      'flutterwave',
      'paytm',
      'phonepe',
      'cashfree',
      'payu',
      'instamojo',
      'bank_transfer',
      'offline',
    ]) {
      expect(hasDriver(s), s).toBe(true);
    }
  });
});

describe('bank transfer and offline (WD-PAYGW-013)', () => {
  const bank = {
    beneficiary_name: 'Acme Ltd',
    bank_name: 'First Bank',
    account_number: '123456',
    ifsc_or_swift: 'FBNKINBB',
    branch: '',
    notes: 'Use the order number as the reference.',
  };

  it('shows only the bank fields that are filled in, makes no network call and settles nothing', async () => {
    const d = createDriver('bank_transfer', ctx(bank, never));
    const r = await d.initiate(order, urls);
    expect(r.status).toBe('pending');
    expect(r.gatewayOrderId).toBe(order.orderNumber);
    expect(r.instructions).toEqual({
      kind: 'bank_transfer',
      rows: [
        { label: 'Beneficiary name', value: 'Acme Ltd' },
        { label: 'Bank name', value: 'First Bank' },
        { label: 'Account number', value: '123456' },
        { label: 'IFSC / SWIFT', value: 'FBNKINBB' },
      ],
      notes: 'Use the order number as the reference.',
    });
    expect((await d.confirmReturn({}, order)).status).toBe('failed');
    expect(await d.verifyWebhook(Buffer.from('{}'), {})).toBe(false);
  });

  it('offline shows the operator text, or the default sentence when none is saved', async () => {
    const withText = await createDriver(
      'offline',
      ctx({ instructions: 'Call sales on 555.' }, never),
    ).initiate(order, urls);
    expect(withText.instructions).toMatchObject({
      kind: 'offline',
      rows: [],
      notes: 'Call sales on 555.',
    });
    const without = await createDriver('offline', ctx({}, never)).initiate(order, urls);
    expect(without.instructions?.notes).toBe('Contact us to arrange payment.');
  });
});

describe('paddle (WD-PAYGW-017)', () => {
  const key = `pdl_sdbx_${'a'.repeat(60)}`; // 69 characters
  const creds = {
    api_key: key,
    product_id: 'pro_1',
    client_token: 'test_tok',
    webhook_secret: 'pdl_ntfset_1',
  };
  const completed = (extra: Record<string, unknown> = {}) => ({
    data: {
      id: 'txn_1',
      status: 'completed',
      currency_code: 'USD',
      custom_data: { order_number: order.orderNumber },
      details: { totals: { grand_total: '4602' } },
      ...extra,
    },
  });

  it('creates a transaction for the exact minor amount and opens the overlay with the client token', async () => {
    const http = vi.fn<HttpFetch>(async () => res(201, { data: { id: 'txn_1' } }));
    const r = await createDriver('paddle', ctx(creds, http)).initiate(order, urls);
    expect(http.mock.calls[0]![0]).toBe('https://sandbox-api.paddle.com/transactions');
    const b = JSON.parse(body(http));
    expect(b.items[0].price.unit_price).toEqual({ amount: '4602', currency_code: 'USD' });
    expect(b.custom_data.order_number).toBe(order.orderNumber);
    expect(b.items[0].price.billing_cycle).toBeNull();
    expect(r.clientAction).toEqual({
      provider: 'paddle',
      params: { clientToken: 'test_tok', environment: 'sandbox', transactionId: 'txn_1' },
    });
    expect(r.gatewayOrderId).toBe('txn_1');
  });

  it('falls back to the hosted checkout url when no client token is saved, and picks the base from the key prefix', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      res(201, { data: { id: 'txn_2', checkout: { url: 'https://pay.paddle.io/x' } } }),
    );
    const live = { ...creds, api_key: `pdl_live_${'b'.repeat(60)}`, client_token: '' };
    const r = await createDriver('paddle', ctx(live, http, 'sandbox')).initiate(order, urls);
    expect(r.redirectUrl).toBe('https://pay.paddle.io/x');
    expect(http.mock.calls[0]![0]).toBe('https://api.paddle.com/transactions');
  });

  it('refuses a truncated key and missing credentials without calling Paddle', async () => {
    const short = await createDriver(
      'paddle',
      ctx({ ...creds, api_key: 'pdl_sdbx_short' }, never),
    ).initiate(order, urls);
    expect(short.error).toContain('incomplete');
    const none = await createDriver('paddle', ctx({}, never)).initiate(order, urls);
    expect(none.error).toBe('paddle_credentials_missing');
  });

  it('confirms the return only with Paddle: the query string alone is never proof, the reference and amount must match', async () => {
    const paid = vi.fn<HttpFetch>(async () => res(200, completed()));
    const d = createDriver('paddle', ctx(creds, paid));
    expect(await d.confirmReturn({ transaction_id: 'txn_1' }, order)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'txn_1',
    });
    expect(await d.confirmReturn({ _ptxn: 'txn_1' }, order)).toMatchObject({ status: 'paid' });

    const notYet = createDriver(
      'paddle',
      ctx(creds, async () => res(200, completed({ status: 'ready' }))),
    );
    // A buyer who types status=completed into the URL gets nothing.
    expect(
      await notYet.confirmReturn({ transaction_id: 'txn_1', status: 'completed' }, order),
    ).toMatchObject({ status: 'pending' });

    const other = createDriver(
      'paddle',
      ctx(creds, async () => res(200, completed({ custom_data: { order_number: 'WSN-OTHER' } }))),
    );
    expect((await other.confirmReturn({ transaction_id: 'txn_1' }, order)).error).toBe(
      'paddle_reference_mismatch',
    );
    const cheap = createDriver(
      'paddle',
      ctx(creds, async () => res(200, completed({ details: { totals: { grand_total: '100' } } }))),
    );
    expect((await cheap.confirmReturn({ transaction_id: 'txn_1' }, order)).error).toBe(
      'paddle_amount_mismatch',
    );
    expect(await d.confirmReturn({}, order)).toMatchObject({ status: 'pending' });
    expect(
      (await d.confirmReturn({ transaction_id: 'txn_9' }, { ...order, gatewayOrderId: 'txn_1' }))
        .error,
    ).toBe('paddle_transaction_mismatch');
  });

  it('verifies the Paddle-Signature (ts + h1) with a replay window and fails closed without a secret', async () => {
    const now = 1_800_000_000_000;
    const d = createDriver('paddle', ctx(creds, never));
    const raw = Buffer.from('{"event_type":"transaction.completed"}');
    const ts = String(Math.floor(now / 1000));
    const sig = `ts=${ts};h1=${hmac('sha256', creds.webhook_secret, `${ts}:${raw.toString()}`)}`;
    const { PaddleDriver } =
      await import('../../../src/infra/providers/platform-payment-gateways/paddle.driver');
    const timed = new PaddleDriver(ctx(creds, never), () => now);
    expect(await timed.verifyWebhook(raw, { 'paddle-signature': sig })).toBe(true);
    expect(await timed.verifyWebhook(Buffer.from('{"x":1}'), { 'paddle-signature': sig })).toBe(
      false,
    );
    expect(
      await new PaddleDriver(ctx(creds, never), () => now + 600_000).verifyWebhook(raw, {
        'paddle-signature': sig,
      }),
    ).toBe(false);
    expect(await timed.verifyWebhook(raw, {})).toBe(false);
    expect(
      await createDriver('paddle', ctx({ ...creds, webhook_secret: '' }, never)).verifyWebhook(
        raw,
        { 'paddle-signature': sig },
      ),
    ).toBe(false);
    expect(d.slug).toBe('paddle');
  });

  it('reads a completed transaction from a notification, and the subscription events', () => {
    const d = createDriver('paddle', ctx(creds, never));
    expect(
      d.parseWebhook({ event_type: 'transaction.completed', data: completed().data }),
    ).toMatchObject({
      orderNumber: order.orderNumber,
      gatewayOrderId: 'txn_1',
      amountMinor: 4602n,
      currency: 'USD',
    });
    expect(d.parseWebhook({ event_type: 'transaction.created', data: {} })).toBeNull();
    const sub = (e: string, data: Record<string, unknown>) =>
      d.parseSubscriptionWebhook!({ event_type: e, data });
    expect(sub('transaction.completed', { id: 't', subscription_id: 'sub_1' })).toMatchObject({
      type: 'renewed',
      subscriptionId: 'sub_1',
      paymentId: 't',
    });
    expect(sub('transaction.completed', { id: 't' })).toBeNull();
    expect(
      sub('subscription.activated', {
        id: 'sub_1',
        current_billing_period: { ends_at: '2026-12-01T00:00:00Z' },
        custom_data: { order_number: 'N1' },
      }),
    ).toMatchObject({
      type: 'created',
      periodEnd: '2026-12-01T00:00:00Z',
      orderNumber: 'N1',
    });
    expect(sub('subscription.canceled', { id: 'sub_1' })?.type).toBe('canceled');
    expect(sub('transaction.payment_failed', { id: 't', subscription_id: 'sub_1' })?.type).toBe(
      'payment_failed',
    );
    expect(sub('address.created', {})).toBeNull();
  });

  it('creates a recurring transaction with the plan interval and cancels at the next billing period', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      res(201, { data: { id: 'txn_3', checkout: { url: 'https://pay.paddle.io/s' } } }),
    );
    const d = createDriver('paddle', ctx(creds, http));
    const r = await d.createSubscription!(
      { ...order, recurring: { interval: 'month', count: 3 } },
      urls,
    );
    const b = JSON.parse(body(http));
    expect(b.items[0].price.billing_cycle).toEqual({ interval: 'month', frequency: 3 });
    expect(b.collection_mode).toBe('automatic');
    expect(r.redirectUrl).toBe('https://pay.paddle.io/s');
    const cancel = vi.fn<HttpFetch>(async () => res(200, { data: {} }));
    expect(
      await createDriver('paddle', ctx(creds, cancel)).cancelSubscription!({
        gatewaySubscriptionId: 'sub_1',
        gatewayCustomerId: null,
        gatewayPlanId: null,
      }),
    ).toEqual({ ok: true });
    expect(cancel.mock.calls[0]![0]).toBe(
      'https://sandbox-api.paddle.com/subscriptions/sub_1/cancel',
    );
    expect(JSON.parse(body(cancel))).toEqual({ effective_from: 'next_billing_period' });
  });
});

describe('paystack (WD-PAYGW-020)', () => {
  const creds = { public_key: 'pk', secret_key: 'sk_test_ps' };
  const ref = `${order.orderNumber}_1700000000000`;
  const verified = (extra: Record<string, unknown> = {}) => ({
    status: true,
    data: { id: 77, status: 'success', amount: 4602, currency: 'USD', reference: ref, ...extra },
  });

  it('initialises for the minor amount with our order number in the reference and metadata', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      res(200, {
        status: true,
        data: { authorization_url: 'https://checkout.paystack.com/x', reference: 'r1' },
      }),
    );
    const r = await createDriver('paystack', ctx(creds, http)).initiate(order, urls);
    const b = JSON.parse(body(http));
    expect(http.mock.calls[0]![0]).toBe('https://api.paystack.co/transaction/initialize');
    expect(b).toMatchObject({
      email: 'buyer@example.com',
      amount: 4602,
      currency: 'USD',
      callback_url: urls.returnUrl,
    });
    expect(b.reference.startsWith(`${order.orderNumber}_`)).toBe(true);
    expect(b.metadata.order_number).toBe(order.orderNumber);
    expect(r).toMatchObject({
      redirectUrl: 'https://checkout.paystack.com/x',
      gatewayOrderId: 'r1',
    });
    expect(
      (
        await createDriver('paystack', ctx(creds, never)).initiate(
          { ...order, customerEmail: null },
          urls,
        )
      ).error,
    ).toBe('paystack_customer_email_missing');
  });

  it('confirms by verifying the reference with Paystack, for our order and the exact amount', async () => {
    const http = vi.fn<HttpFetch>(async () => res(200, verified()));
    const d = createDriver('paystack', ctx(creds, http));
    expect(await d.confirmReturn({ reference: ref }, order)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: '77',
    });
    expect(http.mock.calls[0]![0]).toBe(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`,
    );
    expect((await d.confirmReturn({ trxref: 'WSN-SOMEONE-ELSE_1' }, order)).error).toBe(
      'paystack_reference_mismatch',
    );
    expect((await d.confirmReturn({}, order)).error).toBe('missing_paystack_reference');
    const cheap = createDriver(
      'paystack',
      ctx(creds, async () => res(200, verified({ amount: 1 }))),
    );
    expect((await cheap.confirmReturn({ reference: ref }, order)).error).toBe(
      'paystack_amount_mismatch',
    );
    const abandoned = createDriver(
      'paystack',
      ctx(creds, async () => res(200, verified({ status: 'abandoned' }))),
    );
    expect((await abandoned.confirmReturn({ reference: ref }, order)).error).toBe(
      'paystack_status: abandoned',
    );
  });

  it('verifies x-paystack-signature (HMAC-SHA512 of the raw body) and reads a successful charge', async () => {
    const d = createDriver('paystack', ctx(creds, never));
    const raw = Buffer.from(
      JSON.stringify({
        event: 'charge.success',
        data: {
          id: 1,
          status: 'success',
          amount: 4602,
          currency: 'USD',
          reference: ref,
          metadata: { order_number: order.orderNumber },
        },
      }),
    );
    expect(
      await d.verifyWebhook(raw, { 'x-paystack-signature': hmac('sha512', creds.secret_key, raw) }),
    ).toBe(true);
    expect(await d.verifyWebhook(raw, { 'x-paystack-signature': 'bad' })).toBe(false);
    expect(await d.verifyWebhook(raw, {})).toBe(false);
    expect(
      await createDriver('paystack', ctx({ ...creds, secret_key: '' }, never)).verifyWebhook(raw, {
        'x-paystack-signature': hmac('sha512', '', raw),
      }),
    ).toBe(false);
    expect(d.parseWebhook(JSON.parse(raw.toString()))).toMatchObject({
      orderNumber: order.orderNumber,
      gatewayOrderId: ref,
      amountMinor: 4602n,
      currency: 'USD',
    });
    expect(d.parseWebhook({ event: 'transfer.success', data: {} })).toBeNull();
  });

  it('creates a plan and a subscription transaction, reads its events and cancels with the email token', async () => {
    const http = vi.fn<HttpFetch>(async (url) =>
      url.endsWith('/plan')
        ? res(200, { status: true, data: { plan_code: 'PLN_1' } })
        : res(200, {
            status: true,
            data: { authorization_url: 'https://checkout.paystack.com/s', reference: 'r2' },
          }),
    );
    const d = createDriver('paystack', ctx(creds, http));
    const r = await d.createSubscription!(
      { ...order, recurring: { interval: 'year', count: 1 } },
      urls,
    );
    expect(JSON.parse(body(http, 0))).toMatchObject({
      interval: 'annually',
      amount: 4602,
      name: 'Growth',
    });
    expect(JSON.parse(body(http, 1)).plan).toBe('PLN_1');
    expect(r.payload).toEqual({ gateway_plan_id: 'PLN_1' });
    const ev = (event: string, data: unknown) => d.parseSubscriptionWebhook!({ event, data });
    expect(
      ev('subscription.create', {
        subscription_code: 'SUB_1',
        plan: { plan_code: 'PLN_1' },
        next_payment_date: '2026-12-01',
      }),
    ).toMatchObject({ type: 'created', subscriptionId: 'SUB_1', gatewayPlanId: 'PLN_1' });
    expect(
      ev('invoice.update', {
        status: 'success',
        subscription: { subscription_code: 'SUB_1' },
        transaction: { reference: 'ref9' },
      }),
    ).toMatchObject({ type: 'renewed', paymentId: 'ref9' });
    expect(
      ev('invoice.update', { status: 'failed', subscription: { subscription_code: 'SUB_1' } })
        ?.type,
    ).toBe('payment_failed');
    expect(ev('subscription.not_renew', { subscription_code: 'SUB_1' })?.type).toBe('canceled');
    expect(ev('charge.success', {})).toBeNull();

    const cancel = vi.fn<HttpFetch>(async (url) =>
      url.includes('/disable')
        ? res(200, { status: true })
        : res(200, { status: true, data: { email_token: 'tok' } }),
    );
    expect(
      await createDriver('paystack', ctx(creds, cancel)).cancelSubscription!({
        gatewaySubscriptionId: 'SUB_1',
        gatewayCustomerId: null,
        gatewayPlanId: null,
      }),
    ).toEqual({ ok: true });
    expect(JSON.parse(body(cancel, 1))).toEqual({ code: 'SUB_1', token: 'tok' });
  });
});

describe('flutterwave (WD-PAYGW-020)', () => {
  const creds = { public_key: 'pk', secret_key: 'FLWSECK_TEST-1', secret_hash: 'h4sh' };
  const txRef = `FLW_${order.orderNumber}_1700000000000`;
  const ok = (extra: Record<string, unknown> = {}) => ({
    status: 'success',
    data: { id: 55, status: 'successful', tx_ref: txRef, amount: 46.02, currency: 'USD', ...extra },
  });

  it('creates a hosted payment for the major amount with our reference in tx_ref and meta', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      res(200, {
        status: 'success',
        data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/x' },
      }),
    );
    const r = await createDriver('flutterwave', ctx(creds, http)).initiate(order, urls);
    const b = JSON.parse(body(http));
    expect(b).toMatchObject({ amount: 46.02, currency: 'USD', redirect_url: urls.returnUrl });
    expect(b.tx_ref).toContain(`_${order.orderNumber}_`);
    expect(b.meta.order_number).toBe(order.orderNumber);
    expect(r.redirectUrl).toContain('flutterwave.com');
    const denied = createDriver(
      'flutterwave',
      ctx(creds, async () => res(401, null)),
    );
    expect((await denied.initiate(order, urls)).error).toContain('Secret Key is wrong');
  });

  it('confirms by transaction id or reference, rejects a foreign order and a wrong amount, and treats cancel as a decline', async () => {
    const http = vi.fn<HttpFetch>(async () => res(200, ok()));
    const d = createDriver('flutterwave', ctx(creds, http));
    expect(
      await d.confirmReturn({ transaction_id: '55', tx_ref: txRef, status: 'successful' }, order),
    ).toMatchObject({ status: 'paid', gatewayPaymentId: '55' });
    expect(http.mock.calls[0]![0]).toBe('https://api.flutterwave.com/v3/transactions/55/verify');
    expect(await d.confirmReturn({ tx_ref: txRef }, order)).toMatchObject({ status: 'paid' });
    expect(http.mock.calls[1]![0]).toContain('verify_by_reference?tx_ref=');
    expect((await d.confirmReturn({ status: 'cancelled' }, order)).error).toBe('cancelled_by_user');
    const other = createDriver(
      'flutterwave',
      ctx(creds, async () => res(200, ok({ tx_ref: 'FLW_WSN-OTHER_1' }))),
    );
    expect((await other.confirmReturn({ transaction_id: '55' }, order)).error).toBe(
      'flutterwave_reference_mismatch',
    );
    const cheap = createDriver(
      'flutterwave',
      ctx(creds, async () => res(200, ok({ amount: 1 }))),
    );
    expect((await cheap.confirmReturn({ transaction_id: '55' }, order)).error).toBe(
      'flutterwave_amount_mismatch',
    );
  });

  it('checks the verif-hash header and reads a successful charge with its exact minor amount', async () => {
    const d = createDriver('flutterwave', ctx(creds, never));
    expect(await d.verifyWebhook(Buffer.from('{}'), { 'verif-hash': 'h4sh' })).toBe(true);
    expect(await d.verifyWebhook(Buffer.from('{}'), { 'verif-hash': 'nope' })).toBe(false);
    expect(await d.verifyWebhook(Buffer.from('{}'), {})).toBe(false);
    expect(
      await createDriver('flutterwave', ctx({ ...creds, secret_hash: '' }, never)).verifyWebhook(
        Buffer.from('{}'),
        { 'verif-hash': '' },
      ),
    ).toBe(false);
    expect(
      d.parseWebhook({
        event: 'charge.completed',
        data: {
          id: 55,
          status: 'successful',
          tx_ref: txRef,
          amount: 46.02,
          currency: 'USD',
          meta: { order_number: order.orderNumber },
        },
      }),
    ).toMatchObject({
      orderNumber: order.orderNumber,
      amountMinor: 4602n,
      currency: 'USD',
    });
    expect(d.parseWebhook({ event: 'charge.completed', data: { status: 'failed' } })).toBeNull();
  });

  it('creates a payment plan, reads plan-keyed subscription events and cancels through the subscription list', async () => {
    const http = vi.fn<HttpFetch>(async (url) =>
      url.endsWith('/payment-plans')
        ? res(200, { status: 'success', data: { id: 901 } })
        : res(200, { status: 'success', data: { link: 'https://x/pay' } }),
    );
    const d = createDriver('flutterwave', ctx(creds, http));
    const r = await d.createSubscription!(
      { ...order, recurring: { interval: 'month', count: 1 } },
      urls,
    );
    expect(JSON.parse(body(http, 0))).toMatchObject({ interval: 'monthly', amount: 46.02 });
    expect(JSON.parse(body(http, 1)).payment_plan).toBe('901');
    expect(r.payload).toMatchObject({ gateway_plan_id: '901', gateway_subscription_id: '901' });
    expect(
      d.parseSubscriptionWebhook!({
        event: 'charge.completed',
        data: { id: 5, payment_plan: 901, status: 'successful' },
      }),
    ).toMatchObject({ type: 'renewed', subscriptionId: '901' });
    expect(
      d.parseSubscriptionWebhook!({
        event: 'charge.completed',
        data: { id: 5, payment_plan: 901, status: 'failed' },
      })?.type,
    ).toBe('payment_failed');
    expect(d.parseSubscriptionWebhook!({ event: 'charge.completed', data: { id: 5 } })).toBeNull();
    expect(
      d.parseSubscriptionWebhook!({ event: 'subscription.cancelled', data: { plan: { id: 901 } } })
        ?.type,
    ).toBe('canceled');
    const cancel = vi.fn<HttpFetch>(async (url) =>
      url.includes('/subscriptions?plan=')
        ? res(200, { data: [{ id: 33 }] })
        : res(200, { status: 'success' }),
    );
    expect(
      await createDriver('flutterwave', ctx(creds, cancel)).cancelSubscription!({
        gatewaySubscriptionId: '901',
        gatewayCustomerId: null,
        gatewayPlanId: '901',
      }),
    ).toEqual({ ok: true });
    expect(cancel.mock.calls[1]![0]).toBe('https://api.flutterwave.com/v3/subscriptions/33/cancel');
  });
});

describe('paytm (WD-PAYGW-022)', () => {
  const creds = { merchant_id: 'MID1', merchant_key: 'abcdefghijklmnop', website: 'WEBSTAGING' };
  const orderId = `PAYTM_${order.orderNumber}_1700000000000`;

  it('round-trips its AES checksum and rejects a tampered parameter', () => {
    const p = { ORDERID: orderId, STATUS: 'TXN_SUCCESS', TXNAMOUNT: '46.02' };
    const joined = Object.keys(p)
      .sort()
      .map((k) => p[k as keyof typeof p])
      .join('|');
    const cs = paytmChecksum(joined, creds.merchant_key, 'ab12');
    expect(paytmVerify(p, creds.merchant_key, cs)).toBe(true);
    expect(paytmVerify({ ...p, TXNAMOUNT: '1.00' }, creds.merchant_key, cs)).toBe(false);
    expect(paytmVerify(p, 'zzzzzzzzzzzzzzzz', cs)).toBe(false);
    expect(paytmVerify(p, creds.merchant_key, 'not-base64!')).toBe(false);
  });

  it('gets a transaction token and sends the buyer to the pay page', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      res(200, { body: { resultInfo: { resultCode: 'S' }, txnToken: 'tok1' } }),
    );
    const r = await createDriver('paytm', ctx(creds, http)).initiate(inr, urls);
    expect(http.mock.calls[0]![0]).toContain(
      'https://securegw-stage.paytm.in/theia/api/v1/initiateTransaction?mid=MID1&orderId=PAYTM_',
    );
    const b = JSON.parse(body(http));
    expect(b.body.txnAmount).toEqual({ value: '46.02', currency: 'INR' });
    expect(typeof b.head.signature).toBe('string');
    expect(r.redirectUrl).toContain('showPaymentPage');
    expect(r.gatewayOrderId).toMatch(/^PAYTM_WSN-261005-ABC123_/);
    const live = vi.fn<HttpFetch>(async () =>
      res(200, { body: { resultInfo: { resultCode: 'S' }, txnToken: 't' } }),
    );
    await createDriver('paytm', ctx(creds, live, 'live')).initiate(inr, urls);
    expect(live.mock.calls[0]![0]).toContain('https://securegw.paytm.in/');
  });

  it('accepts a return only when the checksum is valid, then confirms with the status API (or the signed STATUS)', async () => {
    const signed = (p: Record<string, string>): Record<string, string> => {
      const joined = Object.keys(p)
        .sort()
        .map((k) => p[k])
        .join('|');
      return { ...p, CHECKSUMHASH: paytmChecksum(joined, creds.merchant_key, 'cd34') };
    };
    const base = { ORDERID: orderId, STATUS: 'TXN_SUCCESS', TXNAMOUNT: '46.02', BANKTXNID: 'B1' };
    const pending = { ...inr, gatewayOrderId: orderId };
    const api = vi.fn<HttpFetch>(async () =>
      res(200, {
        body: {
          resultInfo: { resultCode: '01', resultStatus: 'TXN_SUCCESS' },
          txnId: 'T1',
          txnAmount: '46.02',
        },
      }),
    );
    const d = createDriver('paytm', ctx(creds, api));
    expect(await d.confirmReturn({ ...signed(base), o: 'tok' }, pending)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'T1',
    });
    expect((await d.confirmReturn({ ...base, CHECKSUMHASH: 'forged' }, pending)).error).toBe(
      'paytm_checksum_invalid',
    );
    expect((await d.confirmReturn(base, pending)).error).toBe('paytm_checksum_invalid');
    expect(
      (await d.confirmReturn(signed({ ...base, ORDERID: 'PAYTM_OTHER' }), pending)).error,
    ).toBe('paytm_order_mismatch');

    const down = createDriver(
      'paytm',
      ctx(creds, async () => {
        throw new Error('down');
      }),
    );
    expect(await down.confirmReturn(signed(base), pending)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'B1',
    });
    expect((await down.confirmReturn(signed({ ...base, TXNAMOUNT: '1.00' }), pending)).error).toBe(
      'paytm_amount_mismatch',
    );
    expect(
      (
        await down.confirmReturn(
          signed({ ...base, STATUS: 'TXN_FAILURE', RESPMSG: 'Declined' }),
          pending,
        )
      ).error,
    ).toBe('paytm: Declined');
    const waiting = createDriver(
      'paytm',
      ctx(creds, async () => res(200, { body: { resultInfo: { resultStatus: 'PENDING' } } })),
    );
    expect((await waiting.confirmReturn(signed(base), pending)).status).toBe('pending');
  });
});

describe('phonepe (WD-PAYGW-022)', () => {
  const v2 = { client_id: 'cid', client_secret: 'sec', client_version: '1' };
  const legacy = { merchant_id: 'M1', salt_key: 'salt', salt_index: '1' };
  const mid = 'PP_WSN-261005-ABC123_1';

  it('v2: fetches an OAuth token, creates the pay order in paisa and redirects', async () => {
    const http = vi.fn<HttpFetch>(async (url) =>
      url.includes('/oauth/token')
        ? res(200, { access_token: 'at' })
        : res(200, { redirectUrl: 'https://mercury.phonepe.com/x' }),
    );
    const r = await createDriver('phonepe', ctx(v2, http)).initiate(inr, urls);
    expect(http.mock.calls[0]![0]).toContain('pg-sandbox/v1/oauth/token');
    expect(http.mock.calls[1]![1].headers!.Authorization).toBe('O-Bearer at');
    const b = JSON.parse(body(http, 1));
    expect(b).toMatchObject({
      amount: 4602,
      paymentFlow: { type: 'PG_CHECKOUT', merchantUrls: { redirectUrl: urls.returnUrl } },
    });
    expect(b.merchantOrderId).toMatch(/^PP_WSN-261005-ABC123_/);
    expect(r.redirectUrl).toBe('https://mercury.phonepe.com/x');
    const noAuth = await createDriver(
      'phonepe',
      ctx(v2, async () => res(401, {})),
    ).initiate(inr, urls);
    expect(noAuth.error).toContain('auth failed');
  });

  it('legacy: signs the request with the salt key and sends the buyer to the pay page', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      res(200, {
        success: true,
        data: { instrumentResponse: { redirectInfo: { url: 'https://phonepe/pay' } } },
      }),
    );
    const r = await createDriver('phonepe', ctx(legacy, http)).initiate(inr, urls);
    const sent = JSON.parse(body(http)).request as string;
    const decoded = JSON.parse(Buffer.from(sent, 'base64').toString());
    expect(decoded).toMatchObject({ merchantId: 'M1', amount: 4602, callbackUrl: urls.notifyUrl });
    const expected = `${createHash('sha256').update(`${sent}/pg/v1/pay${legacy.salt_key}`).digest('hex')}###1`;
    expect(http.mock.calls[0]![1].headers!['X-VERIFY']).toBe(expected);
    expect(r.redirectUrl).toBe('https://phonepe/pay');
    expect((await createDriver('phonepe', ctx({}, never)).initiate(inr, urls)).error).toContain(
      'phonepe_credentials_missing',
    );
  });

  it('confirms the return from the status API using the STORED order id, never one from the request', async () => {
    const http = vi.fn<HttpFetch>(async (url) =>
      url.includes('/oauth/token')
        ? res(200, { access_token: 'at' })
        : res(200, {
            state: 'COMPLETED',
            amount: 4602,
            orderId: 'OM1',
            paymentDetails: [{ transactionId: 'TX1' }],
          }),
    );
    const d = createDriver('phonepe', ctx(v2, http));
    const stored = { ...inr, gatewayOrderId: mid };
    expect(await d.confirmReturn({ merchantOrderId: 'PP_FORGED' }, stored)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'TX1',
    });
    expect(http.mock.calls[1]![0]).toContain(`/checkout/v2/order/${mid}/status`);
    expect((await d.confirmReturn({}, inr)).error).toBe('missing_phonepe_merchant_tx');
    const cheap = createDriver(
      'phonepe',
      ctx(v2, async (url) =>
        url.includes('oauth')
          ? res(200, { access_token: 'a' })
          : res(200, { state: 'COMPLETED', amount: 100 }),
      ),
    );
    expect((await cheap.confirmReturn({}, stored)).error).toBe('phonepe_amount_mismatch');
    const wait = createDriver(
      'phonepe',
      ctx(v2, async (url) =>
        url.includes('oauth') ? res(200, { access_token: 'a' }) : res(200, { state: 'PENDING' }),
      ),
    );
    expect((await wait.confirmReturn({}, stored)).status).toBe('pending');
    const failed = createDriver(
      'phonepe',
      ctx(v2, async (url) =>
        url.includes('oauth') ? res(200, { access_token: 'a' }) : res(200, { state: 'FAILED' }),
      ),
    );
    expect((await failed.confirmReturn({}, stored)).error).toBe('phonepe_status: FAILED');

    const legacyHttp = vi.fn<HttpFetch>(async () =>
      res(200, { code: 'PAYMENT_SUCCESS', data: { transactionId: 'TXL', amount: 4602 } }),
    );
    const ld = createDriver('phonepe', ctx(legacy, legacyHttp));
    expect(await ld.confirmReturn({}, stored)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'TXL',
    });
    const endpoint = `/pg/v1/status/M1/${mid}`;
    expect(legacyHttp.mock.calls[0]![1].headers!['X-VERIFY']).toBe(
      `${createHash('sha256').update(`${endpoint}salt`).digest('hex')}###1`,
    );
  });

  it('legacy webhooks are verified with X-VERIFY over the base64 response; v2 ones only when PhonePe itself confirms', async () => {
    const response = Buffer.from(
      JSON.stringify({
        code: 'PAYMENT_SUCCESS',
        data: { merchantTransactionId: mid, transactionId: 'T9', amount: 4602 },
      }),
    ).toString('base64');
    const raw = Buffer.from(JSON.stringify({ response }));
    const xv = `${createHash('sha256').update(`${response}salt`).digest('hex')}###1`;
    const ld = createDriver('phonepe', ctx(legacy, never));
    expect(await ld.verifyWebhook(raw, { 'x-verify': xv })).toBe(true);
    expect(await ld.verifyWebhook(raw, { 'x-verify': 'bad' })).toBe(false);
    expect(ld.parseWebhook({ response })).toMatchObject({
      gatewayOrderId: mid,
      amountMinor: 4602n,
    });

    const http = vi.fn<HttpFetch>(async (url) =>
      url.includes('oauth') ? res(200, { access_token: 'a' }) : res(200, { state: 'COMPLETED' }),
    );
    const vd = createDriver('phonepe', ctx(v2, http));
    const v2raw = Buffer.from(
      JSON.stringify({ payload: { merchantOrderId: mid, state: 'COMPLETED', orderId: 'OM1' } }),
    );
    expect(await vd.verifyWebhook(v2raw, {})).toBe(true);
    const lying = createDriver(
      'phonepe',
      ctx(v2, async (url) =>
        url.includes('oauth') ? res(200, { access_token: 'a' }) : res(200, { state: 'PENDING' }),
      ),
    );
    expect(await lying.verifyWebhook(v2raw, {})).toBe(false);
    expect(
      vd.parseWebhook({ payload: { merchantOrderId: mid, state: 'COMPLETED', orderId: 'OM1' } }),
    ).toMatchObject({ gatewayOrderId: mid });
  });
});

describe('cashfree (WD-PAYGW-022)', () => {
  const creds = { app_id: 'app1', secret_key: 'cfsk_1' };
  const cfOrder = `CF_${order.orderNumber}_1`;

  it('creates a payment session and hands the browser a client action, no server HTML', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      res(200, { payment_session_id: 'sess_1', cf_order_id: 9 }),
    );
    const r = await createDriver('cashfree', ctx(creds, http)).initiate(inr, urls);
    const b = JSON.parse(body(http));
    expect(http.mock.calls[0]![0]).toBe('https://sandbox.cashfree.com/pg/orders');
    expect(http.mock.calls[0]![1].headers!['x-api-version']).toBe('2023-08-01');
    expect(b).toMatchObject({ order_amount: 46.02, order_currency: 'INR' });
    expect(b.order_meta.return_url).toBe(`${urls.returnUrl}&order_id={order_id}`);
    expect(r.clientAction).toEqual({
      provider: 'cashfree',
      params: { sessionId: 'sess_1', mode: 'sandbox' },
    });
    expect(r.gatewayOrderId).toContain(`CF_${order.orderNumber}_`);
  });

  it('confirms PAID orders for our order id and amount only', async () => {
    const paidBody = {
      order_status: 'PAID',
      cf_order_id: 9,
      order_amount: 46.02,
      order_currency: 'INR',
    };
    const d = createDriver(
      'cashfree',
      ctx(creds, async () => res(200, paidBody)),
    );
    const stored = { ...inr, gatewayOrderId: cfOrder };
    expect(await d.confirmReturn({ order_id: cfOrder }, stored)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: '9',
    });
    expect((await d.confirmReturn({ order_id: 'CF_OTHER' }, stored)).error).toBe(
      'cashfree_order_mismatch',
    );
    expect((await d.confirmReturn({}, stored)).error).toBe('missing_cashfree_order_id');
    const cheap = createDriver(
      'cashfree',
      ctx(creds, async () => res(200, { ...paidBody, order_amount: 1 })),
    );
    expect((await cheap.confirmReturn({ order_id: cfOrder }, stored)).error).toBe(
      'cashfree_amount_mismatch',
    );
    const active = createDriver(
      'cashfree',
      ctx(creds, async () => res(200, { order_status: 'ACTIVE' })),
    );
    expect((await active.confirmReturn({ order_id: cfOrder }, stored)).error).toBe(
      'cashfree_status: ACTIVE',
    );
  });

  it('verifies the documented webhook signature (timestamp + body, base64 HMAC) that WaDesk never checked', async () => {
    const d = createDriver('cashfree', ctx(creds, never));
    const raw = Buffer.from(
      JSON.stringify({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: { order_id: cfOrder },
          payment: { payment_amount: 46.02, payment_currency: 'INR' },
        },
      }),
    );
    const ts = '1700000000';
    const sig = hmac('sha256', creds.secret_key, ts + raw.toString(), 'base64');
    expect(
      await d.verifyWebhook(raw, { 'x-webhook-signature': sig, 'x-webhook-timestamp': ts }),
    ).toBe(true);
    expect(
      await d.verifyWebhook(raw, { 'x-webhook-signature': sig, 'x-webhook-timestamp': '1' }),
    ).toBe(false);
    expect(await d.verifyWebhook(raw, {})).toBe(false);
    expect(d.parseWebhook(JSON.parse(raw.toString()))).toMatchObject({
      gatewayOrderId: cfOrder,
      amountMinor: 4602n,
      currency: 'INR',
    });
    expect(d.parseWebhook({ type: 'PAYMENT_FAILED_WEBHOOK' })).toBeNull();
  });
});

describe('payu (WD-PAYGW-022)', () => {
  const creds = { merchant_key: 'KEY1', merchant_salt: 'SALT1' };
  const sha512 = (s: string) => createHash('sha512').update(s).digest('hex');

  it('returns a signed form post for PayU; the internal order id is not sent', async () => {
    const r = await createDriver('payu', ctx(creds, never)).initiate(inr, urls);
    const f = r.formPost!;
    expect(f.url).toBe('https://sandboxsecure.payu.in/_payment');
    expect(f.fields).toMatchObject({
      key: 'KEY1',
      amount: '46.02',
      email: 'buyer@example.com',
      surl: urls.returnUrl,
      udf1: order.orderNumber,
    });
    expect(f.fields.furl).toBe(`${urls.returnUrl}&status=failed`);
    expect('udf2' in f.fields).toBe(false);
    const expected = sha512(
      [
        'KEY1',
        f.fields.txnid,
        '46.02',
        f.fields.productinfo,
        'Ada Buyer',
        'buyer@example.com',
        order.orderNumber,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'SALT1',
      ].join('|'),
    );
    expect(f.fields.hash).toBe(expected);
    expect(r.gatewayOrderId).toBe(f.fields.txnid);
    expect((await createDriver('payu', ctx({}, never)).initiate(inr, urls)).error).toBe(
      'payu_credentials_missing',
    );
  });

  it('accepts a return only with the reverse hash, our txn id and the exact amount', async () => {
    const txnid = `PAYU_${order.orderNumber}_1`;
    const make = (over: Record<string, string> = {}) => {
      const p: Record<string, string> = {
        status: 'success',
        txnid,
        amount: '46.02',
        productinfo: 'Order',
        firstname: 'Ada Buyer',
        email: 'buyer@example.com',
        udf1: order.orderNumber,
        mihpayid: 'P1',
        ...over,
      };
      const reverse = [
        'SALT1',
        p.status,
        '',
        '',
        '',
        '',
        '',
        p.udf5 ?? '',
        p.udf4 ?? '',
        p.udf3 ?? '',
        p.udf2 ?? '',
        p.udf1,
        p.email,
        p.firstname,
        p.productinfo,
        p.amount,
        p.txnid,
        'KEY1',
      ].join('|');
      return { ...p, hash: sha512(reverse) };
    };
    const d = createDriver('payu', ctx(creds, never));
    const stored = { ...inr, gatewayOrderId: txnid };
    expect(await d.confirmReturn(make(), stored)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'P1',
    });
    expect((await d.confirmReturn({ ...make(), hash: 'forged' }, stored)).error).toBe(
      'payu_hash_mismatch',
    );
    expect((await d.confirmReturn({ ...make(), amount: '1.00' }, stored)).error).toBe(
      'payu_hash_mismatch',
    );
    const cheap = make({ amount: '1.00' });
    expect((await d.confirmReturn(cheap, stored)).error).toBe('payu_amount_mismatch');
    expect((await d.confirmReturn(make({ txnid: 'PAYU_OTHER' }), stored)).error).toBe(
      'payu_txnid_mismatch',
    );
    const { hash: _h, ...nohash } = make();
    expect((await d.confirmReturn(nohash, stored)).error).toBe('missing_payu_hash');
    expect(
      (await d.confirmReturn(make({ status: 'failure', error_Message: 'Bank declined' }), stored))
        .error,
    ).toBe('payu: Bank declined');
  });
});

describe('instamojo (WD-PAYGW-022)', () => {
  const creds = { api_key: 'k', auth_token: 't', salt: 'salty' };

  it('creates a payment request for the major amount with our webhook url', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      res(201, {
        success: true,
        payment_request: { id: 'PR1', longurl: 'https://test.instamojo.com/@x/PR1' },
      }),
    );
    const r = await createDriver('instamojo', ctx(creds, http)).initiate(inr, urls);
    const form = new URLSearchParams(body(http));
    expect(http.mock.calls[0]![0]).toBe('https://test.instamojo.com/api/1.1/payment-requests/');
    expect(form.get('amount')).toBe('46.02');
    expect(form.get('webhook')).toBe(urls.notifyUrl);
    expect(form.get('redirect_url')).toBe(urls.returnUrl);
    expect(r).toMatchObject({
      redirectUrl: 'https://test.instamojo.com/@x/PR1',
      gatewayOrderId: 'PR1',
    });
    const bad = createDriver(
      'instamojo',
      ctx(creds, async () => res(400, { success: false, message: { email: ['bad'] } })),
    );
    expect((await bad.initiate(inr, urls)).error).toBe('instamojo: {"email":["bad"]}');
  });

  it('confirms with the payment API: Credit status, our request id, the exact amount', async () => {
    const credit = { payment_request: { payment: { status: 'Credit', amount: '46.02' } } };
    const d = createDriver(
      'instamojo',
      ctx(creds, async () => res(200, credit)),
    );
    const stored = { ...inr, gatewayOrderId: 'PR1' };
    expect(
      await d.confirmReturn(
        { payment_id: 'MOJO1', payment_request_id: 'PR1', payment_status: 'Credit' },
        stored,
      ),
    ).toMatchObject({ status: 'paid', gatewayPaymentId: 'MOJO1' });
    expect(
      (await d.confirmReturn({ payment_id: 'M', payment_request_id: 'PR_OTHER' }, stored)).error,
    ).toBe('instamojo_request_mismatch');
    expect((await d.confirmReturn({}, stored)).error).toBe('missing_instamojo_params');
    const cheap = createDriver(
      'instamojo',
      ctx(creds, async () =>
        res(200, { payment_request: { payment: { status: 'Credit', amount: '1.00' } } }),
      ),
    );
    expect(
      (await cheap.confirmReturn({ payment_id: 'M', payment_request_id: 'PR1' }, stored)).error,
    ).toBe('instamojo_amount_mismatch');
    const failed = createDriver(
      'instamojo',
      ctx(creds, async () => res(200, { payment_request: { payment: { status: 'Failed' } } })),
    );
    expect(
      (await failed.confirmReturn({ payment_id: 'M', payment_request_id: 'PR1' }, stored)).error,
    ).toBe('instamojo_status: Failed');
  });

  it('verifies the form-encoded webhook MAC (HMAC-SHA1 over sorted values) and reads a credited payment', async () => {
    const d = createDriver('instamojo', ctx(creds, never));
    const fields: Record<string, string> = {
      amount: '46.02',
      buyer: 'buyer@example.com',
      payment_id: 'MOJO1',
      payment_request_id: 'PR1',
      status: 'Credit',
    };
    const mac = hmac(
      'sha1',
      'salty',
      Object.keys(fields)
        .sort()
        .map((k) => fields[k])
        .join('|'),
    );
    const raw = Buffer.from(new URLSearchParams({ ...fields, mac }).toString());
    expect(await d.verifyWebhook(raw, {})).toBe(true);
    expect(
      await d.verifyWebhook(
        Buffer.from(new URLSearchParams({ ...fields, amount: '1', mac }).toString()),
        {},
      ),
    ).toBe(false);
    expect(await d.verifyWebhook(Buffer.from(new URLSearchParams(fields).toString()), {})).toBe(
      false,
    );
    expect(
      await createDriver('instamojo', ctx({ ...creds, salt: '' }, never)).verifyWebhook(raw, {}),
    ).toBe(false);
    expect(d.parseWebhook(fields)).toMatchObject({
      gatewayOrderId: 'PR1',
      gatewayPaymentId: 'MOJO1',
      amountMinor: 4602n,
    });
    expect(d.parseWebhook({ ...fields, status: 'Failed' })).toBeNull();
  });
});

describe('recurring support on the original three drivers (WD-PAYGW-012)', () => {
  const rec = { ...order, recurring: { interval: 'month' as const, count: 1 } };

  it('stripe: a subscription-mode session with inline recurring price data and our order number', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      res(200, { id: 'cs_s', url: 'https://checkout.stripe.com/s' }),
    );
    const d = createDriver('stripe', ctx({ secret_key: 'sk', webhook_secret: 'w' }, http));
    expect(d.supportsRecurring?.()).toBe(true);
    const r = await d.createSubscription!(rec, urls);
    const f = new URLSearchParams(body(http));
    expect(f.get('mode')).toBe('subscription');
    expect(f.get('line_items[0][price_data][recurring][interval]')).toBe('month');
    expect(f.get('subscription_data[metadata][order_number]')).toBe(order.orderNumber);
    expect(r.redirectUrl).toBe('https://checkout.stripe.com/s');
    const evt = (type: string, object: Record<string, unknown>) =>
      d.parseSubscriptionWebhook!({ type, data: { object } });
    expect(
      evt('invoice.paid', {
        subscription: 'sub_1',
        billing_reason: 'subscription_create',
        payment_intent: 'pi',
        lines: { data: [{ period: { end: 1800000000 } }] },
        subscription_details: { metadata: { order_number: order.orderNumber } },
      }),
    ).toMatchObject({
      type: 'created',
      subscriptionId: 'sub_1',
      periodEnd: 1800000000,
      orderNumber: order.orderNumber,
    });
    expect(
      evt('invoice.paid', {
        subscription: 'sub_1',
        billing_reason: 'subscription_cycle',
        id: 'in_2',
      })?.type,
    ).toBe('renewed');
    expect(evt('invoice.payment_failed', { subscription: 'sub_1', id: 'in_3' })?.type).toBe(
      'payment_failed',
    );
    expect(evt('customer.subscription.deleted', { id: 'sub_1' })?.type).toBe('canceled');
    expect(
      evt('checkout.session.completed', {
        mode: 'subscription',
        subscription: 'sub_1',
        metadata: { order_number: 'N' },
      }),
    ).toMatchObject({ type: 'created', orderNumber: 'N' });
    expect(evt('checkout.session.completed', { mode: 'payment' })).toBeNull();
    expect(evt('charge.refunded', {})).toBeNull();
  });

  it('stripe: the paid return of a subscription session carries the subscription and customer ids', async () => {
    const session = {
      id: 'cs_s',
      client_reference_id: order.orderNumber,
      payment_status: 'paid',
      amount_total: 4602,
      currency: 'usd',
      subscription: 'sub_1',
      customer: 'cus_1',
    };
    const d = createDriver(
      'stripe',
      ctx({ secret_key: 'sk' }, async () => res(200, session)),
    );
    const r = await d.confirmReturn({ session_id: 'cs_s' }, { ...order, gatewayOrderId: 'cs_s' });
    expect(r).toMatchObject({
      status: 'paid',
      payload: { gateway_subscription_id: 'sub_1', gateway_customer_id: 'cus_1' },
    });
  });

  it('razorpay: a plan then a subscription, checked with the payment_id|subscription_id signature, polled for the reconciler', async () => {
    const http = vi.fn<HttpFetch>(async (url) =>
      url.endsWith('/plans') ? res(200, { id: 'plan_1' }) : res(200, { id: 'sub_1' }),
    );
    const creds = { key_id: 'rzp_test', key_secret: 'secret', webhook_secret: 'w' };
    const d = createDriver('razorpay', ctx(creds, http));
    const r = await d.createSubscription!(
      { ...inr, recurring: { interval: 'year', count: 1 } },
      urls,
    );
    expect(JSON.parse(body(http, 0))).toMatchObject({
      period: 'yearly',
      interval: 1,
      item: { amount: 4602, currency: 'INR' },
    });
    expect(JSON.parse(body(http, 1))).toMatchObject({ plan_id: 'plan_1', total_count: 10 });
    expect(r.clientAction).toMatchObject({
      provider: 'razorpay',
      params: { subscriptionId: 'sub_1', keyId: 'rzp_test', callbackUrl: urls.returnUrl },
    });
    expect(r.payload).toEqual({ gateway_subscription_id: 'sub_1', gateway_plan_id: 'plan_1' });

    const sig = hmac('sha256', 'secret', 'pay_1|sub_1');
    const stored = { ...inr, gatewayOrderId: 'sub_1' };
    expect(
      await d.confirmReturn(
        {
          razorpay_subscription_id: 'sub_1',
          razorpay_payment_id: 'pay_1',
          razorpay_signature: sig,
        },
        stored,
      ),
    ).toMatchObject({ status: 'paid', payload: { gateway_subscription_id: 'sub_1' } });
    expect(
      (
        await d.confirmReturn(
          {
            razorpay_subscription_id: 'sub_1',
            razorpay_payment_id: 'pay_1',
            razorpay_signature: hmac('sha256', 'secret', 'sub_1|pay_1'),
          },
          stored,
        )
      ).error,
    ).toBe('razorpay_sub_signature_mismatch');

    const ev = (
      event: string,
      sub: Record<string, unknown>,
      payment: Record<string, unknown> = {},
    ) =>
      d.parseSubscriptionWebhook!({
        event,
        payload: { subscription: { entity: sub }, payment: { entity: payment } },
      });
    expect(
      ev(
        'subscription.charged',
        { id: 'sub_1', current_end: 1800000000, notes: { order_number: 'N1' } },
        { id: 'pay_2' },
      ),
    ).toMatchObject({
      type: 'renewed',
      paymentId: 'pay_2',
      periodEnd: 1800000000,
      orderNumber: 'N1',
    });
    expect(ev('subscription.halted', { id: 'sub_1' })?.type).toBe('payment_failed');
    expect(ev('subscription.cancelled', { id: 'sub_1' })?.type).toBe('canceled');
    expect(ev('payment.captured', {})).toBeNull();

    const poll = (status: string) =>
      createDriver(
        'razorpay',
        ctx(creds, async () => res(200, { status, current_end: 1800000000 })),
      ).fetchSubscription!({
        gatewaySubscriptionId: 'sub_1',
        gatewayCustomerId: null,
        gatewayPlanId: null,
      });
    expect(await poll('active')).toEqual({ status: 'active', periodEnd: 1800000000 });
    expect(await poll('halted')).toMatchObject({ status: 'past_due' });
    expect(await poll('cancelled')).toMatchObject({ status: 'canceled' });
    expect(await poll('expired')).toMatchObject({ status: 'expired' });
    expect(await poll('weird')).toBeNull();
    expect(
      await createDriver(
        'razorpay',
        ctx(creds, async () => res(500, {})),
      ).fetchSubscription!({
        gatewaySubscriptionId: 'sub_1',
        gatewayCustomerId: null,
        gatewayPlanId: null,
      }),
    ).toBeNull();
  });

  it('paypal: product, plan, subscription with our order number as custom_id; confirmed by fetching it', async () => {
    const http = vi.fn<HttpFetch>(async (url, init) => {
      if (url.includes('/oauth2/token')) return res(200, { access_token: 'at' });
      if (url.endsWith('/catalogs/products')) return res(201, { id: 'PROD-1' });
      if (url.endsWith('/billing/plans')) return res(201, { id: 'P-1' });
      if (url.endsWith('/billing/subscriptions') && init.method === 'POST')
        return res(201, {
          id: 'I-1',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve' }],
        });
      return res(200, {
        id: 'I-1',
        status: 'ACTIVE',
        custom_id: order.orderNumber,
        billing_info: { next_billing_time: '2026-12-01T00:00:00Z' },
      });
    });
    const d = createDriver(
      'paypal',
      ctx({ client_id: 'c', client_secret: 's', webhook_id: 'w' }, http),
    );
    const r = await d.createSubscription!(
      { ...rec, recurring: { interval: 'month', count: 1 } },
      urls,
    );
    const planBody = JSON.parse(
      String(http.mock.calls.find((c) => c[0].endsWith('/billing/plans'))![1].body),
    );
    expect(planBody.billing_cycles[0]).toMatchObject({
      frequency: { interval_unit: 'MONTH', interval_count: 1 },
      total_cycles: 0,
    });
    expect(planBody.billing_cycles[0].pricing_scheme.fixed_price).toEqual({
      value: '46.02',
      currency_code: 'USD',
    });
    expect(r).toMatchObject({
      redirectUrl: 'https://paypal.com/approve',
      gatewayOrderId: 'I-1',
      payload: { gateway_subscription_id: 'I-1', gateway_plan_id: 'P-1' },
    });
    expect(
      await d.confirmReturn({ subscription_id: 'I-1' }, { ...order, gatewayOrderId: 'I-1' }),
    ).toMatchObject({
      status: 'paid',
      payload: { gateway_subscription_id: 'I-1', current_period_end: '2026-12-01T00:00:00Z' },
    });
    expect(
      (
        await d.confirmReturn(
          { subscription_id: 'I-1' },
          { ...order, orderNumber: 'WSN-OTHER', gatewayOrderId: 'I-1' },
        )
      ).error,
    ).toBe('paypal_reference_mismatch');
    const ev = (event_type: string, resource: Record<string, unknown>) =>
      d.parseSubscriptionWebhook!({ event_type, resource });
    expect(
      ev('BILLING.SUBSCRIPTION.ACTIVATED', {
        id: 'I-1',
        custom_id: 'N1',
        billing_info: { next_billing_time: '2026-12-01T00:00:00Z' },
      }),
    ).toMatchObject({ type: 'created', orderNumber: 'N1' });
    expect(ev('PAYMENT.SALE.COMPLETED', { id: 's1', billing_agreement_id: 'I-1' })).toMatchObject({
      type: 'renewed',
      paymentId: 's1',
    });
    expect(ev('PAYMENT.SALE.COMPLETED', { id: 's1' })).toBeNull();
    expect(ev('BILLING.SUBSCRIPTION.SUSPENDED', { id: 'I-1' })?.type).toBe('payment_failed');
    expect(ev('BILLING.SUBSCRIPTION.EXPIRED', { id: 'I-1' })?.type).toBe('canceled');
  });
});
