import { describe, expect, it } from 'vitest';
import { yearlyOffer } from '../../../src/modules/plans-subscriptions-trials/plan-rules';
import {
  createDriver,
  type DriverContext,
  type HttpFetch,
} from '../../../src/infra/providers/platform-payment-gateways';

const plan = (over: Record<string, unknown> = {}) => ({
  isFree: false,
  isCustomQuote: false,
  isLifetime: false,
  amount: '49.00',
  offerAmount: null,
  billingUnit: 'months' as const,
  billingDuration: 1,
  ...over,
});

describe('yearlyOffer (TW-PLAN-011 rule 3)', () => {
  it('is 12 months less the discount, rounded half up to the cent, with the per-month equivalent', () => {
    expect(yearlyOffer(plan(), 20)).toEqual({ perMonth: '39.20', perYear: '470.40' });
    expect(yearlyOffer(plan({ amount: '9.99' }), 20)).toEqual({
      perMonth: '7.99',
      perYear: '95.90',
    });
    expect(yearlyOffer(plan(), 0)).toEqual({ perMonth: '49.00', perYear: '588.00' });
  });
  it('uses the offer when there is one, and ignores an offer that is not lower', () => {
    expect(yearlyOffer(plan({ offerAmount: '40.00' }), 10)?.perYear).toBe('432.00');
    expect(yearlyOffer(plan({ offerAmount: '60.00' }), 0)?.perYear).toBe('588.00');
  });
  it('gives nothing for free, lifetime, custom quotes and plans on another period', () => {
    expect(yearlyOffer(plan({ isFree: true, amount: '0.00' }), 20)).toBeNull();
    expect(yearlyOffer(plan({ isLifetime: true }), 20)).toBeNull();
    expect(yearlyOffer(plan({ isCustomQuote: true, amount: '0.00' }), 20)).toBeNull();
    expect(yearlyOffer(plan({ billingUnit: 'years' }), 20)).toBeNull();
    expect(yearlyOffer(plan({ billingDuration: 3 }), 20)).toBeNull();
  });
});

describe('payment drivers: cancelSubscription (TW-PLAN-012)', () => {
  const ref = { gatewaySubscriptionId: 'sub_123', gatewayCustomerId: null, gatewayPlanId: null };
  function ctx(credentials: Record<string, string>, status = 200) {
    const calls: Array<{
      url: string;
      method: string;
      body?: string;
      headers?: Record<string, string>;
    }> = [];
    const http: HttpFetch = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body, headers: init.headers });
      if (url.endsWith('/oauth2/token'))
        return { status: 200, json: { access_token: 'tok' }, text: '' };
      return { status, json: {}, text: '' };
    };
    const c: DriverContext = { credentials, mode: 'sandbox', http };
    return { c, calls };
  }

  it('Stripe stops renewal at the end of the paid period', async () => {
    const { c, calls } = ctx({ secret_key: 'sk_test' });
    const out = await createDriver('stripe', c).cancelSubscription!(ref);
    expect(out).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      url: 'https://api.stripe.com/v1/subscriptions/sub_123',
      method: 'POST',
      body: 'cancel_at_period_end=true',
    });
  });
  it('Razorpay cancels at the cycle end', async () => {
    const { c, calls } = ctx({ key_id: 'k', key_secret: 's' });
    expect(await createDriver('razorpay', c).cancelSubscription!(ref)).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      url: 'https://api.razorpay.com/v1/subscriptions/sub_123/cancel',
      body: '{"cancel_at_cycle_end":1}',
    });
  });
  it('PayPal cancels the billing subscription after getting a token', async () => {
    const { c, calls } = ctx({ client_id: 'i', client_secret: 's' });
    expect(await createDriver('paypal', c).cancelSubscription!(ref)).toEqual({ ok: true });
    expect(calls[1]!.url).toMatch(/\/v1\/billing\/subscriptions\/sub_123\/cancel$/);
    expect(calls[1]!.headers?.Authorization).toBe('Bearer tok');
  });
  it.each(['stripe', 'razorpay', 'paypal'])(
    '%s reports a provider refusal and missing credentials without throwing',
    async (slug) => {
      const { c } = ctx(
        { secret_key: 'x', key_id: 'x', key_secret: 'x', client_id: 'x', client_secret: 'x' },
        500,
      );
      const failed = await createDriver(slug, c).cancelSubscription!(ref);
      expect(failed.ok).toBe(false);
      expect(failed.reason).toContain('500');
      const missing = await createDriver(slug, ctx({}).c).cancelSubscription!(ref);
      expect(missing.ok).toBe(false);
      expect(missing.reason).toMatch(/missing/);
    },
  );
  it('turns a network exception into a failure result', async () => {
    const boom: DriverContext = {
      credentials: { secret_key: 'sk' },
      mode: 'sandbox',
      http: async () => {
        throw new Error('socket hang up');
      },
    };
    const out = await createDriver('stripe', boom).cancelSubscription!(ref);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('socket hang up');
  });
});
