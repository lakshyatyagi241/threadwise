import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  GATEWAY_CATALOGUE,
  createDriver,
  credentialFieldsFor,
  hasDriver,
  webhookFieldKeys,
  type DriverContext,
  type DriverOrder,
  type HttpFetch,
} from '../../../src/infra/providers/platform-payment-gateways';
import { StripeDriver } from '../../../src/infra/providers/platform-payment-gateways/stripe.driver';

const order: DriverOrder = {
  orderNumber: 'WSN-261005-ABC123',
  amountMinor: 4602n,
  amountMajor: '46.02',
  currency: 'USD',
  description: 'Growth plan',
  customerEmail: 'buyer@example.com',
  gatewayOrderId: null,
};
const urls = {
  returnUrl: 'https://api.test/v2/payments/return/stripe?o=tok',
  notifyUrl: 'https://api.test/n',
};

const json = (status: number, body: unknown) => ({
  status,
  json: body,
  text: JSON.stringify(body),
});
const ctx = (
  credentials: Record<string, string>,
  http: HttpFetch,
  mode: 'sandbox' | 'live' = 'sandbox',
): DriverContext => ({ credentials, mode, http });
const never: HttpFetch = async () => {
  throw new Error('no network in this test');
};

describe('catalogue', () => {
  it('has the 33 gateways with unique slugs and one required-field schema each', () => {
    expect(GATEWAY_CATALOGUE).toHaveLength(33);
    expect(new Set(GATEWAY_CATALOGUE.map((g) => g.slug)).size).toBe(33);
    expect(credentialFieldsFor('razorpay').map((f) => [f.key, !!f.required])).toEqual([
      ['key_id', true],
      ['key_secret', true],
      ['webhook_secret', false],
    ]);
    expect(credentialFieldsFor('bank_transfer').find((f) => f.key === 'notes')?.type).toBe(
      'textarea',
    );
    expect(credentialFieldsFor('nope')).toEqual([]);
  });
  it('names the webhook-signing fields (fail-closed rule)', () => {
    expect(webhookFieldKeys('stripe')).toEqual(['webhook_secret']);
    expect(webhookFieldKeys('paypal')).toEqual(['webhook_id']);
    expect(webhookFieldKeys('mollie')).toEqual([]);
  });
  it('only drivers that exist can be activated', () => {
    expect(['stripe', 'razorpay', 'paypal'].every(hasDriver)).toBe(true);
    expect(hasDriver('mollie')).toBe(false);
    expect(() => createDriver('mollie', ctx({}, never))).toThrow();
  });
});

describe('stripe driver', () => {
  const creds = { secret_key: 'sk_test_1', webhook_secret: 'whsec_1' };

  it('creates a hosted session charging the exact minor amount and carrying our order number', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      json(200, { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }),
    );
    const r = await createDriver('stripe', ctx(creds, http)).initiate(order, urls);
    expect(r).toMatchObject({
      status: 'pending',
      redirectUrl: 'https://checkout.stripe.com/c/cs_1',
      gatewayOrderId: 'cs_1',
    });
    const form = new URLSearchParams(http.mock.calls[0]![1].body);
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('4602');
    expect(form.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(form.get('client_reference_id')).toBe(order.orderNumber);
    expect(form.get('success_url')).toContain('&session_id={CHECKOUT_SESSION_ID}');
  });

  it('charges a zero-decimal currency without multiplying by 100', async () => {
    const http = vi.fn<HttpFetch>(async () => json(200, { id: 'cs_2', url: 'https://x' }));
    await createDriver('stripe', ctx(creds, http)).initiate(
      { ...order, currency: 'JPY', amountMinor: 5000n, amountMajor: '5000' },
      urls,
    );
    const form = new URLSearchParams(http.mock.calls[0]![1].body);
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('5000');
  });

  it('turns a thrown provider call into a failed result instead of an exception', async () => {
    const http: HttpFetch = async () => {
      throw new Error('timeout');
    };
    const r = await createDriver('stripe', ctx(creds, http)).initiate(order, urls);
    expect(r).toMatchObject({ status: 'failed', error: 'stripe_exception: timeout' });
  });

  it('missing secret key fails before any call', async () => {
    const http = vi.fn<HttpFetch>();
    expect((await createDriver('stripe', ctx({}, http)).initiate(order, urls)).error).toBe(
      'stripe_secret_key_missing',
    );
    expect(http).not.toHaveBeenCalled();
  });

  const session = (over: Record<string, unknown> = {}) => ({
    id: 'cs_1',
    client_reference_id: order.orderNumber,
    payment_status: 'paid',
    payment_intent: 'pi_1',
    amount_total: 4602,
    currency: 'usd',
    ...over,
  });

  it('return: a paid session of the right amount is paid with the payment intent', async () => {
    const http: HttpFetch = async () => json(200, session());
    const r = await createDriver('stripe', ctx(creds, http)).confirmReturn(
      { session_id: 'cs_1' },
      { ...order, gatewayOrderId: 'cs_1' },
    );
    expect(r).toMatchObject({ status: 'paid', gatewayPaymentId: 'pi_1' });
  });

  it('return: cancelled is a decline, an unpaid session stays pending, a wrong amount or reference fails', async () => {
    const d = (over: Record<string, unknown>) =>
      createDriver(
        'stripe',
        ctx(creds, async () => json(200, session(over))),
      );
    expect((await d({}).confirmReturn({ cancelled: '1' }, order)).error).toBe('cancelled_by_user');
    expect((await d({}).confirmReturn({}, order)).error).toBe('missing_session_id');
    expect(
      await d({ payment_status: 'unpaid' }).confirmReturn({ session_id: 'cs_1' }, order),
    ).toMatchObject({
      status: 'pending',
    });
    expect((await d({ amount_total: 1 }).confirmReturn({ session_id: 'cs_1' }, order)).error).toBe(
      'stripe_amount_mismatch',
    );
    expect(
      (await d({ client_reference_id: 'OTHER' }).confirmReturn({ session_id: 'cs_1' }, order))
        .error,
    ).toBe('stripe_reference_mismatch');
    expect(
      (await d({}).confirmReturn({ session_id: 'cs_9' }, { ...order, gatewayOrderId: 'cs_1' }))
        .error,
    ).toBe('stripe_session_mismatch');
  });

  describe('webhook signature', () => {
    const body = Buffer.from(JSON.stringify({ type: 'checkout.session.completed' }));
    const sign = (t: number, secret = 'whsec_1') =>
      `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body.toString()}`).digest('hex')}`;
    const now = 1_800_000_000_000;
    const at = (c: Record<string, string>) => new StripeDriver(ctx(c, never), () => now);

    it('accepts a valid signature inside the tolerance', async () => {
      expect(await at(creds).verifyWebhook(body, { 'stripe-signature': sign(now / 1000) })).toBe(
        true,
      );
    });
    it('rejects a tampered body, a wrong secret, a stale timestamp, no header and no configured secret', async () => {
      const d = at(creds);
      expect(
        await d.verifyWebhook(Buffer.from('{}'), { 'stripe-signature': sign(now / 1000) }),
      ).toBe(false);
      expect(await d.verifyWebhook(body, { 'stripe-signature': sign(now / 1000, 'other') })).toBe(
        false,
      );
      expect(await d.verifyWebhook(body, { 'stripe-signature': sign(now / 1000 - 301) })).toBe(
        false,
      );
      expect(await d.verifyWebhook(body, {})).toBe(false);
      expect(
        await at({ secret_key: 'x' }).verifyWebhook(body, { 'stripe-signature': sign(now / 1000) }),
      ).toBe(false);
    });
  });

  it('parses only a paid completed session, with our reference and the collected amount', () => {
    const d = createDriver('stripe', ctx(creds, never));
    const evt = (type: string, s: Record<string, unknown>) => ({ type, data: { object: s } });
    expect(d.parseWebhook(evt('checkout.session.completed', session()))).toMatchObject({
      orderNumber: order.orderNumber,
      gatewayPaymentId: 'pi_1',
      amountMinor: 4602n,
      currency: 'USD',
    });
    expect(
      d.parseWebhook(evt('checkout.session.completed', session({ payment_status: 'unpaid' }))),
    ).toBeNull();
    expect(d.parseWebhook(evt('charge.refunded', session()))).toBeNull();
  });
});

describe('razorpay driver', () => {
  const creds = { key_id: 'rzp_test_1', key_secret: 'secret', webhook_secret: 'whsec' };
  const inr: DriverOrder = {
    ...order,
    currency: 'INR',
    amountMinor: 118000n,
    amountMajor: '1180.00',
  };

  it('creates a Razorpay order and hands the browser the widget parameters (no HTML)', async () => {
    const http = vi.fn<HttpFetch>(async () => json(200, { id: 'order_1' }));
    const r = await createDriver('razorpay', ctx(creds, http)).initiate(inr, urls);
    expect(JSON.parse(http.mock.calls[0]![1].body!)).toMatchObject({
      amount: 118000,
      currency: 'INR',
      receipt: inr.orderNumber,
    });
    expect(r.gatewayOrderId).toBe('order_1');
    expect(r.clientAction).toMatchObject({
      provider: 'razorpay',
      params: { keyId: 'rzp_test_1', orderId: 'order_1', amountMinor: 118000 },
    });
  });

  const sig = (orderId: string, payId: string, secret = 'secret') =>
    createHmac('sha256', secret).update(`${orderId}|${payId}`).digest('hex');

  it('return: valid signature pays, wrong signature fails, dismissal is a decline', async () => {
    const d = createDriver('razorpay', ctx(creds, never));
    const o = { ...inr, gatewayOrderId: 'order_1' };
    const ok = {
      razorpay_order_id: 'order_1',
      razorpay_payment_id: 'pay_1',
      razorpay_signature: sig('order_1', 'pay_1'),
    };
    expect(await d.confirmReturn(ok, o)).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'pay_1',
    });
    expect(
      (await d.confirmReturn({ ...ok, razorpay_signature: sig('order_1', 'pay_1', 'bad') }, o))
        .error,
    ).toBe('razorpay_signature_mismatch');
    expect((await d.confirmReturn({ cancelled: '1' }, o)).error).toBe('cancelled_by_user');
    expect((await d.confirmReturn({}, o)).error).toBe('missing_razorpay_params');
    expect(
      (
        await d.confirmReturn(
          { ...ok, razorpay_order_id: 'order_2', razorpay_signature: sig('order_2', 'pay_1') },
          o,
        )
      ).error,
    ).toBe('razorpay_order_mismatch');
  });

  it('webhook: HMAC over the raw body; a missing secret rejects', async () => {
    const raw = Buffer.from('{"event":"payment.captured"}');
    const good = createHmac('sha256', 'whsec').update(raw).digest('hex');
    const d = createDriver('razorpay', ctx(creds, never));
    expect(await d.verifyWebhook(raw, { 'x-razorpay-signature': good })).toBe(true);
    expect(await d.verifyWebhook(raw, { 'x-razorpay-signature': 'x' })).toBe(false);
    const noSecret = createDriver('razorpay', ctx({ key_id: 'a', key_secret: 'b' }, never));
    expect(await noSecret.verifyWebhook(raw, { 'x-razorpay-signature': good })).toBe(false);
  });

  it('webhook: payment.captured maps to our order number and amount', () => {
    const p = createDriver('razorpay', ctx(creds, never)).parseWebhook({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_1',
            order_id: 'order_1',
            amount: 118000,
            currency: 'INR',
            notes: { order_number: inr.orderNumber },
          },
        },
      },
    });
    expect(p).toMatchObject({
      orderNumber: inr.orderNumber,
      gatewayOrderId: 'order_1',
      gatewayPaymentId: 'pay_1',
      amountMinor: 118000n,
    });
  });
});

describe('paypal driver', () => {
  const creds = { client_id: 'id', client_secret: 'sec', webhook_id: 'WH-1' };
  const route =
    (handlers: Record<string, (body?: string) => Promise<ReturnType<typeof json>>>): HttpFetch =>
    async (url, init) => {
      const key = `${init.method} ${new URL(url).pathname}`;
      const h = handlers[key];
      if (!h) throw new Error(`unexpected ${key}`);
      return h(init.body);
    };
  const auth = { 'POST /v1/oauth2/token': async () => json(200, { access_token: 'tok' }) };

  it('creates an order and returns the approval link, amount in major units', async () => {
    let sent = '';
    const http = route({
      ...auth,
      'POST /v2/checkout/orders': async (b) => {
        sent = b ?? '';
        return json(201, {
          id: 'PP1',
          links: [{ rel: 'payer-action', href: 'https://paypal.test/approve' }],
        });
      },
    });
    const r = await createDriver('paypal', ctx(creds, http)).initiate(order, urls);
    expect(r).toMatchObject({
      status: 'pending',
      redirectUrl: 'https://paypal.test/approve',
      gatewayOrderId: 'PP1',
    });
    expect(JSON.parse(sent).purchase_units[0]).toMatchObject({
      custom_id: order.orderNumber,
      amount: { currency_code: 'USD', value: '46.02' },
    });
  });

  const completed = (value = '46.02') => ({
    status: 'COMPLETED',
    purchase_units: [
      {
        payments: {
          captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'USD', value } }],
        },
      },
    ],
  });

  it('return: captures and is paid only for a COMPLETED capture of the right amount', async () => {
    const o = { ...order, gatewayOrderId: 'PP1' };
    const ok = route({
      ...auth,
      'POST /v2/checkout/orders/PP1/capture': async () => json(201, completed()),
    });
    expect(
      await createDriver('paypal', ctx(creds, ok)).confirmReturn({ token: 'PP1' }, o),
    ).toMatchObject({
      status: 'paid',
      gatewayPaymentId: 'CAP1',
    });
    const wrong = route({
      ...auth,
      'POST /v2/checkout/orders/PP1/capture': async () => json(201, completed('1.00')),
    });
    expect(
      (await createDriver('paypal', ctx(creds, wrong)).confirmReturn({ token: 'PP1' }, o)).error,
    ).toBe('paypal_amount_mismatch');
    const declined = route({
      ...auth,
      'POST /v2/checkout/orders/PP1/capture': async () =>
        json(201, { status: 'PAYER_ACTION_REQUIRED' }),
    });
    expect(
      (await createDriver('paypal', ctx(creds, declined)).confirmReturn({ token: 'PP1' }, o)).error,
    ).toBe('paypal_status: PAYER_ACTION_REQUIRED');
    expect(
      (await createDriver('paypal', ctx(creds, ok)).confirmReturn({ cancelled: '1' }, o)).error,
    ).toBe('cancelled_by_user');
    expect(
      (await createDriver('paypal', ctx(creds, ok)).confirmReturn({ token: 'PPX' }, o)).error,
    ).toBe('paypal_order_mismatch');
  });

  it('return: a reload (already captured) reads the order instead of failing', async () => {
    const http = route({
      ...auth,
      'POST /v2/checkout/orders/PP1/capture': async () =>
        json(422, { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }),
      'GET /v2/checkout/orders/PP1': async () => json(200, completed()),
    });
    const r = await createDriver('paypal', ctx(creds, http)).confirmReturn(
      { token: 'PP1' },
      { ...order, gatewayOrderId: 'PP1' },
    );
    expect(r.status).toBe('paid');
  });

  it('webhook: verified through PayPal; without a webhook id it rejects', async () => {
    const raw = Buffer.from('{"id":"WH"}');
    const headers = {
      'paypal-transmission-sig': 's',
      'paypal-transmission-id': 'i',
      'paypal-auth-algo': 'a',
      'paypal-cert-url': 'c',
      'paypal-transmission-time': 't',
    };
    const verify = (status: string) =>
      route({
        ...auth,
        'POST /v1/notifications/verify-webhook-signature': async () =>
          json(200, { verification_status: status }),
      });
    expect(
      await createDriver('paypal', ctx(creds, verify('SUCCESS'))).verifyWebhook(raw, headers),
    ).toBe(true);
    expect(
      await createDriver('paypal', ctx(creds, verify('FAILURE'))).verifyWebhook(raw, headers),
    ).toBe(false);
    const noId = createDriver(
      'paypal',
      ctx({ client_id: 'a', client_secret: 'b' }, verify('SUCCESS')),
    );
    expect(await noId.verifyWebhook(raw, headers)).toBe(false);
  });

  it('webhook: capture completed maps to our reference', () => {
    const p = createDriver('paypal', ctx(creds, never)).parseWebhook({
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'CAP1',
        status: 'COMPLETED',
        custom_id: order.orderNumber,
        amount: { currency_code: 'USD', value: '46.02' },
        supplementary_data: { related_ids: { order_id: 'PP1' } },
      },
    });
    expect(p).toMatchObject({
      orderNumber: order.orderNumber,
      gatewayOrderId: 'PP1',
      gatewayPaymentId: 'CAP1',
      amountMinor: 4602n,
      currency: 'USD',
    });
  });
});
