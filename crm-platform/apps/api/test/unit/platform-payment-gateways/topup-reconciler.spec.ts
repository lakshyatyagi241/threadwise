import { describe, expect, it, vi } from 'vitest';
import {
  createDriver,
  type DriverContext,
  type DriverOrder,
  type HttpFetch,
} from '../../../src/infra/providers/platform-payment-gateways';
import { TopupReconcilerService } from '../../../src/modules/platform-payment-gateways/topup-reconciler.service';

/** Legacy #11798/#11841/#15173: a paid top-up whose webhook and browser return were lost is found and credited by asking the provider. */
const order: DriverOrder = {
  orderNumber: 'WSN-1',
  amountMinor: 50000n,
  amountMajor: '500.00',
  currency: 'INR',
  description: 'Wallet top-up',
  gatewayOrderId: 'order_1',
};
const res = (status: number, json: unknown) => ({ status, json, text: JSON.stringify(json) });
const ctx = (http: HttpFetch): DriverContext => ({
  credentials: { key_id: 'k', key_secret: 's' },
  mode: 'sandbox',
  http,
});
const razorpay = (http: HttpFetch) => createDriver('razorpay', ctx(http))!;
const pay = (over: Record<string, unknown> = {}) => ({
  id: 'pay_1',
  status: 'captured',
  amount: 50000,
  currency: 'INR',
  ...over,
});

describe('razorpay lookupPayment', () => {
  it('is paid for a captured payment of exactly the order amount', async () => {
    const http = vi.fn<HttpFetch>(async () => res(200, { items: [pay()] }));
    const r = await razorpay(http).lookupPayment!(order);
    expect(r).toMatchObject({ status: 'paid', gatewayPaymentId: 'pay_1' });
    expect(http.mock.calls[0]![0]).toContain('/orders/order_1/payments');
  });

  it('is not paid for a failed, authorised-only or short payment', async () => {
    for (const p of [
      pay({ status: 'failed' }),
      pay({ status: 'authorized' }),
      pay({ amount: 100 }),
    ]) {
      const r = await razorpay(async () => res(200, { items: [p] })).lookupPayment!(order);
      expect(r?.status).toBe('pending');
    }
  });

  it('cannot tell when the call fails or the order has no provider id', async () => {
    expect(await razorpay(async () => res(500, {})).lookupPayment!(order)).toBeNull();
    expect(
      await razorpay(async () => res(200, { items: [pay()] })).lookupPayment!({
        ...order,
        gatewayOrderId: null,
      }),
    ).toBeNull();
  });
});

function build(lookup: unknown, orderOver: Record<string, unknown> = {}) {
  const row = {
    uuid: 'u1',
    orderNumber: 'WSN-1',
    status: 'pending',
    kind: 'wallet_topup',
    gatewaySlug: 'razorpay',
    totalAmount: '500.00',
    currency: 'INR',
    gatewayOrderId: 'order_1',
    ...orderOver,
  };
  const fulfil = vi.fn(async () => ({ applied: true }));
  const svc = new TopupReconcilerService(
    { tx: async (fn: (t: unknown) => unknown) => fn({}) } as never,
    { bySlug: async () => ({}), driverFor: () => ({ lookupPayment: lookup }) } as never,
    { byUuid: async () => row } as never,
    { fulfil } as never,
  );
  return { svc, fulfil };
}

describe('TopupReconcilerService.reconcileOne', () => {
  it('runs the fulfilment when the provider says the order was paid', async () => {
    const { svc, fulfil } = build(async () => ({ status: 'paid', gatewayPaymentId: 'pay_1' }));
    expect(await svc.reconcileOne('u1')).toBe('credited');
    expect(fulfil).toHaveBeenCalledOnce();
  });

  it('credits nothing while the provider says pending, or cannot be asked', async () => {
    const a = build(async () => ({ status: 'pending' }));
    expect(await a.svc.reconcileOne('u1')).toBe('still_pending');
    const b = build(async () => null);
    expect(await b.svc.reconcileOne('u1')).toBe('skip_cannot_tell');
    expect(a.fulfil).not.toHaveBeenCalled();
    expect(b.fulfil).not.toHaveBeenCalled();
  });

  it('leaves an order that is no longer a pending top-up alone, and a driver with no lookup', async () => {
    const paidAlready = build(async () => ({ status: 'paid' }), { status: 'paid' });
    expect(await paidAlready.svc.reconcileOne('u1')).toBe('already_settled');
    expect(paidAlready.fulfil).not.toHaveBeenCalled();
    expect(await build(undefined).svc.reconcileOne('u1')).toBe('skip_no_driver');
  });

  it('reports a replay (fulfilment already owned by another path) as already settled', async () => {
    const { svc, fulfil } = build(async () => ({ status: 'paid', gatewayPaymentId: 'p' }));
    fulfil.mockResolvedValueOnce({ applied: false });
    expect(await svc.reconcileOne('u1')).toBe('already_settled');
  });
});
