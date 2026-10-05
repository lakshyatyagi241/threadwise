import { describe, expect, it, vi } from 'vitest';
import {
  createDriver,
  type DriverContext,
  type DriverOrder,
  type HttpFetch,
  type ProviderPlanCache,
  type ProviderPlanKey,
} from '../../../src/infra/providers/platform-payment-gateways';

/**
 * Razorpay hardening: a provider plan is made once per account, price and cadence, and a payment that belongs to a subscription
 * charge is never mistaken for a one-off payment. No network: every call goes through the injected fetch.
 */
const creds = { key_id: 'rzp_test_1', key_secret: 'secret', webhook_secret: 'whsec' };
const urls = { returnUrl: 'https://api.test/return?o=tok', notifyUrl: 'https://api.test/n' };
const inr: DriverOrder = {
  orderNumber: 'WSN-261022-AAA111',
  amountMinor: 49900n,
  amountMajor: '499.00',
  currency: 'INR',
  description: 'Extra seat',
  planName: 'Extra seat',
  recurring: { interval: 'month', count: 1 },
};
const res = (status: number, json: unknown) => ({ status, json, text: JSON.stringify(json) });

function memoryCache(): ProviderPlanCache & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  const k = (key: ProviderPlanKey) =>
    [key.account, key.currency, key.amountMinor, key.unit, key.count].join('|');
  return {
    rows,
    find: async (key) => rows.get(k(key)) ?? null,
    save: async (key, id) => void rows.set(k(key), id),
  };
}
const ctx = (http: HttpFetch, planCache?: ProviderPlanCache): DriverContext => ({
  credentials: creds,
  mode: 'sandbox',
  http,
  planCache,
});
const planCalls = (http: ReturnType<typeof vi.fn<HttpFetch>>) =>
  http.mock.calls.filter(([url]) => url.endsWith('/plans')).length;

describe('razorpay plan reuse', () => {
  it('creates the plan once and reuses it for the same price and cadence', async () => {
    const cache = memoryCache();
    let n = 0;
    const http = vi.fn<HttpFetch>(async (url) =>
      url.endsWith('/plans') ? res(200, { id: 'plan_1' }) : res(200, { id: `sub_${++n}` }),
    );
    const d = createDriver('razorpay', ctx(http, cache));
    const a = await d.createSubscription!(inr, urls);
    const b = await d.createSubscription!({ ...inr, orderNumber: 'WSN-261022-BBB222' }, urls);
    expect(planCalls(http)).toBe(1);
    expect(a.payload).toMatchObject({
      gateway_plan_id: 'plan_1',
      gateway_subscription_id: 'sub_1',
    });
    expect(b.payload).toMatchObject({
      gateway_plan_id: 'plan_1',
      gateway_subscription_id: 'sub_2',
    });
  });

  it('makes a new plan for a different price or cadence', async () => {
    const cache = memoryCache();
    let p = 0;
    const http = vi.fn<HttpFetch>(async (url) =>
      url.endsWith('/plans') ? res(200, { id: `plan_${++p}` }) : res(200, { id: 'sub_x' }),
    );
    const d = createDriver('razorpay', ctx(http, cache));
    await d.createSubscription!(inr, urls);
    await d.createSubscription!({ ...inr, amountMinor: 99900n }, urls);
    await d.createSubscription!({ ...inr, recurring: { interval: 'year', count: 1 } }, urls);
    expect(planCalls(http)).toBe(3);
  });

  it('replaces a cached plan the provider no longer has, once', async () => {
    const cache = memoryCache();
    const http = vi.fn<HttpFetch>(async (url, init) => {
      if (url.endsWith('/plans')) return res(200, { id: 'plan_new' });
      const body = JSON.parse(init.body!) as { plan_id: string };
      return body.plan_id === 'plan_gone'
        ? res(400, { error: { description: 'The id provided does not exist' } })
        : res(200, { id: 'sub_ok' });
    });
    // the lookup always returns the stale id; saving writes through to the memory cache
    const realKeyCache: ProviderPlanCache = {
      find: async () => 'plan_gone',
      save: async (k, id) => cache.save(k, id),
    };
    const r = await createDriver('razorpay', ctx(http, realKeyCache)).createSubscription!(
      inr,
      urls,
    );
    expect(planCalls(http)).toBe(1);
    expect(r.payload).toMatchObject({
      gateway_plan_id: 'plan_new',
      gateway_subscription_id: 'sub_ok',
    });
    expect([...cache.rows.values()]).toContain('plan_new');
  });

  it('still works with no cache, and a failing cache never fails the checkout', async () => {
    const http = vi.fn<HttpFetch>(async (url) =>
      url.endsWith('/plans') ? res(200, { id: 'plan_1' }) : res(200, { id: 'sub_1' }),
    );
    expect((await createDriver('razorpay', ctx(http)).createSubscription!(inr, urls)).status).toBe(
      'pending',
    );
    const broken: ProviderPlanCache = {
      find: async () => Promise.reject(new Error('db down')),
      save: async () => Promise.reject(new Error('db down')),
    };
    expect(
      (await createDriver('razorpay', ctx(http, broken)).createSubscription!(inr, urls)).status,
    ).toBe('pending');
  });
});

describe('razorpay payment vs subscription webhooks', () => {
  const d = createDriver(
    'razorpay',
    ctx(async () => res(200, {})),
  );
  const payment = (entity: Record<string, unknown>) => ({
    event: 'payment.captured',
    payload: { payment: { entity } },
  });

  it('ignores the payment of a subscription charge (it carries an invoice id)', () => {
    expect(
      d.parseWebhook(
        payment({ id: 'pay_9', order_id: 'order_9', invoice_id: 'inv_9', amount: 49900 }),
      ),
    ).toBeNull();
  });

  it('still reads a one-off payment, such as a wallet top-up or a plan bought once', () => {
    expect(
      d.parseWebhook(
        payment({
          id: 'pay_1',
          order_id: 'order_1',
          amount: 49900,
          currency: 'INR',
          notes: { order_number: inr.orderNumber },
        }),
      ),
    ).toMatchObject({ orderNumber: inr.orderNumber, gatewayPaymentId: 'pay_1' });
  });

  it('a subscription event is never read as a payment, and a payment event never as a subscription event', () => {
    const charged = {
      event: 'subscription.charged',
      payload: {
        subscription: {
          entity: { id: 'sub_1', current_end: 1_800_000_000, notes: { order_number: 'N' } },
        },
        payment: { entity: { id: 'pay_1', order_id: 'order_1', invoice_id: 'inv_1' } },
      },
    };
    expect(d.parseSubscriptionWebhook(charged)).toMatchObject({
      type: 'renewed',
      subscriptionId: 'sub_1',
      paymentId: 'pay_1',
    });
    expect(d.parseWebhook(charged)).toBeNull();
    expect(
      d.parseSubscriptionWebhook(payment({ id: 'pay_1', order_id: 'order_1', amount: 100 })),
    ).toBeNull();
  });

  it('maps a failed charge and the halted subscription to payment_failed, and cancel/complete to canceled', () => {
    const ev = (event: string) => ({
      event,
      payload: { subscription: { entity: { id: 'sub_1' } } },
    });
    expect(d.parseSubscriptionWebhook(ev('subscription.pending'))?.type).toBe('payment_failed');
    expect(d.parseSubscriptionWebhook(ev('subscription.halted'))?.type).toBe('payment_failed');
    expect(d.parseSubscriptionWebhook(ev('subscription.cancelled'))?.type).toBe('canceled');
    expect(d.parseSubscriptionWebhook(ev('subscription.completed'))?.type).toBe('canceled');
    expect(d.parseSubscriptionWebhook(ev('subscription.activated'))).toBeNull();
  });
});
