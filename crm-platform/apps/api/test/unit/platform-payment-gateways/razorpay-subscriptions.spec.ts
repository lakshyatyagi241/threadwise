import { describe, expect, it, vi } from 'vitest';
import {
  createDriver,
  type DriverContext,
  type HttpFetch,
} from '../../../src/infra/providers/platform-payment-gateways';

/** Razorpay subscription management: cancel (at cycle end or now), the charge history, refunds and the webhook events. No network. */
const creds = { key_id: 'rzp_test_1', key_secret: 'secret', webhook_secret: 'whsec' };
const res = (status: number, json: unknown) => ({ status, json, text: JSON.stringify(json) });
const driver = (http: HttpFetch) =>
  createDriver('razorpay', { credentials: creds, mode: 'sandbox', http } as DriverContext);
const ref = { gatewaySubscriptionId: 'sub_1', gatewayCustomerId: null, gatewayPlanId: 'plan_1' };
const body = (http: ReturnType<typeof vi.fn<HttpFetch>>, i = 0) =>
  JSON.parse(String(http.mock.calls[i]![1]?.body ?? '{}'));

describe('cancelSubscription', () => {
  it('stops the next charge at the end of the paid cycle by default', async () => {
    const http = vi.fn<HttpFetch>(async () => res(200, { id: 'sub_1', status: 'active' }));
    expect(await driver(http).cancelSubscription!(ref)).toEqual({ ok: true });
    expect(http.mock.calls[0]![0]).toBe('https://api.razorpay.com/v1/subscriptions/sub_1/cancel');
    expect(body(http)).toEqual({ cancel_at_cycle_end: 1 });
  });

  it('ends it now when asked (a replaced plan must never be charged at the old price again)', async () => {
    const http = vi.fn<HttpFetch>(async () => res(200, { id: 'sub_1' }));
    await driver(http).cancelSubscription!(ref, { atCycleEnd: false });
    expect(body(http)).toEqual({ cancel_at_cycle_end: 0 });
  });

  it('treats a subscription that is already cancelled or completed as done', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      res(400, { error: { description: 'Subscription cannot be cancelled in cancelled status' } }),
    );
    expect((await driver(http).cancelSubscription!(ref)).ok).toBe(true);
  });

  it('reports any other failure with its status, and a thrown error without leaking', async () => {
    const down = vi.fn<HttpFetch>(async () => res(500, { error: { description: 'oops' } }));
    expect(await driver(down).cancelSubscription!(ref)).toEqual({
      ok: false,
      reason: 'razorpay_http_500',
    });
    const boom = vi.fn<HttpFetch>(async () => {
      throw new Error('socket hang up');
    });
    expect((await driver(boom).cancelSubscription!(ref)).reason).toMatch(/^razorpay_exception/);
  });
});

describe('listSubscriptionCharges', () => {
  it('maps the invoices of the subscription: amount, status, dates, receipt page, payment', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      res(200, {
        items: [
          {
            id: 'inv_2',
            amount: 79900,
            currency: 'inr',
            status: 'paid',
            issued_at: 1_790_000_000,
            paid_at: 1_790_000_100,
            short_url: 'https://rzp.io/i/abc',
            payment_id: 'pay_2',
          },
          { id: 'inv_1', amount: 79900, currency: 'INR', status: 'expired', date: 1_787_000_000 },
          { id: 'inv_x', status: 'paid' }, // no amount: skipped
        ],
      }),
    );
    const out = await driver(http).listSubscriptionCharges!(ref);
    expect(http.mock.calls[0]![0]).toBe(
      'https://api.razorpay.com/v1/invoices?subscription_id=sub_1&count=50',
    );
    expect(out).toHaveLength(2);
    expect(out![0]).toMatchObject({
      id: 'inv_2',
      amountMinor: 79900n,
      currency: 'INR',
      status: 'paid',
      receiptUrl: 'https://rzp.io/i/abc',
      paymentId: 'pay_2',
      paidAt: new Date(1_790_000_100 * 1000).toISOString(),
    });
    expect(out![1]).toMatchObject({ status: 'expired', paymentId: null, paidAt: null });
  });

  it('is null (cannot tell) when the provider errors, and empty for no invoices', async () => {
    expect(
      await driver(vi.fn<HttpFetch>(async () => res(500, {}))).listSubscriptionCharges!(ref),
    ).toBeNull();
    expect(
      await driver(vi.fn<HttpFetch>(async () => res(200, { items: [] }))).listSubscriptionCharges!(
        ref,
      ),
    ).toEqual([]);
  });
});

describe('refundPayment', () => {
  it('refunds the whole payment, or an amount of it, with the reason as a note', async () => {
    const http = vi.fn<HttpFetch>(async () => res(200, { id: 'rfnd_1', status: 'processed' }));
    const whole = await driver(http).refundPayment!({ paymentId: 'pay_9' });
    expect(whole).toEqual({ ok: true, refundId: 'rfnd_1', status: 'processed' });
    expect(http.mock.calls[0]![0]).toBe('https://api.razorpay.com/v1/payments/pay_9/refund');
    expect(body(http)).toEqual({ speed: 'normal' });
    await driver(http).refundPayment!({
      paymentId: 'pay_9',
      amountMinor: 25000n,
      note: 'Duplicate charge',
    });
    expect(body(http, 1)).toEqual({
      amount: 25000,
      speed: 'normal',
      notes: { reason: 'Duplicate charge' },
    });
  });

  it('sends our refund uuid as the idempotency key and as a note, so a repeat cannot refund twice and a list can be matched back', async () => {
    const http = vi.fn<HttpFetch>(async () => res(200, { id: 'rfnd_1', status: 'pending' }));
    await driver(http).refundPayment!({
      paymentId: 'pay_9',
      note: 'Duplicate charge',
      idempotencyKey: '6f1c0c1e-0000-4000-8000-000000000001',
      reference: '6f1c0c1e-0000-4000-8000-000000000001',
    });
    const init = http.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['X-Refund-Idempotency']).toBe(
      '6f1c0c1e-0000-4000-8000-000000000001',
    );
    expect(body(http).notes).toEqual({
      reason: 'Duplicate charge',
      ref: '6f1c0c1e-0000-4000-8000-000000000001',
    });
  });

  it('says why when Razorpay refuses', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      res(400, { error: { description: 'The payment has been fully refunded already' } }),
    );
    const out = await driver(http).refundPayment!({ paymentId: 'pay_9' });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('fully refunded');
  });
});

describe('listPaymentRefunds', () => {
  it('lists the refunds of a payment with the reference we stored on them', async () => {
    const http = vi.fn<HttpFetch>(async () =>
      res(200, {
        items: [
          {
            id: 'rfnd_2',
            amount: 25000,
            status: 'processed',
            created_at: 1_795_000_100,
            notes: { ref: 'uuid-2' },
          },
          { id: 'rfnd_1', amount: 5000, status: 'pending', created_at: 1_795_000_000 },
          { id: 'bad', status: 'processed' },
        ],
      }),
    );
    const out = await driver(http).listPaymentRefunds!('pay_9');
    expect(http.mock.calls[0]![0]).toBe(
      'https://api.razorpay.com/v1/payments/pay_9/refunds?count=100',
    );
    expect(out).toEqual([
      {
        id: 'rfnd_2',
        amountMinor: 25000n,
        status: 'processed',
        createdAt: new Date(1_795_000_100_000),
        reference: 'uuid-2',
      },
      {
        id: 'rfnd_1',
        amountMinor: 5000n,
        status: 'pending',
        createdAt: new Date(1_795_000_000_000),
        reference: null,
      },
    ]);
  });

  it('answers null (cannot tell), never an empty list, when the call fails', async () => {
    const failing = vi.fn<HttpFetch>(async () => res(500, { error: { description: 'oops' } }));
    expect(await driver(failing).listPaymentRefunds!('pay_9')).toBeNull();
    const thrown = vi.fn<HttpFetch>(async () => {
      throw new Error('socket hang up');
    });
    expect(await driver(thrown).listPaymentRefunds!('pay_9')).toBeNull();
  });
});

describe('subscription webhook events', () => {
  const evt = (event: string, extra: Record<string, unknown> = {}) => ({
    event,
    payload: {
      subscription: {
        entity: {
          id: 'sub_1',
          current_end: 1_795_000_000,
          notes: { order_number: 'WSN-1' },
          ...extra,
        },
      },
    },
  });
  const d = driver(vi.fn<HttpFetch>());

  it('charged renews, pending and halted are past due, cancelled and completed end it; activated and updated are left to charged and the reconciler (activated first would count the first charge twice)', () => {
    expect(d.parseSubscriptionWebhook!(evt('subscription.charged'))?.type).toBe('renewed');
    expect(d.parseSubscriptionWebhook!(evt('subscription.pending'))?.type).toBe('payment_failed');
    expect(d.parseSubscriptionWebhook!(evt('subscription.halted'))?.type).toBe('payment_failed');
    expect(d.parseSubscriptionWebhook!(evt('subscription.cancelled'))?.type).toBe('canceled');
    expect(d.parseSubscriptionWebhook!(evt('subscription.completed'))?.type).toBe('canceled');
    for (const ignored of [
      'subscription.authenticated',
      'subscription.activated',
      'subscription.updated',
    ]) {
      expect(d.parseSubscriptionWebhook!(evt(ignored)), ignored).toBeNull();
    }
    expect(
      d.parseSubscriptionWebhook!({ event: 'subscription.activated', payload: {} }),
    ).toBeNull();
  });
});
