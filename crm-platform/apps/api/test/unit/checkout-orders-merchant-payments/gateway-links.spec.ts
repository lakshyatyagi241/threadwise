import { describe, expect, it } from 'vitest';
import type { PaymentDriver } from '../../../src/infra/providers/platform-payment-gateways';
import type { RazorpayPort } from '../../../src/infra/providers/storefront-builder/razorpay.port';
import { GatewayLinkService } from '../../../src/modules/checkout-orders-merchant-payments/gateways/gateway-link.service';
import { GatewayPaymentRegistry } from '../../../src/modules/checkout-orders-merchant-payments/gateways/gateway-payment.registry';
import { parseRazorpayLinkPaid } from '../../../src/modules/checkout-orders-merchant-payments/gateways/razorpay-link-event';
import type {
  ResolvedGateway,
  WorkspaceGatewayResolver,
} from '../../../src/modules/checkout-orders-merchant-payments/gateways/workspace-gateway.resolver';
import {
  attemptFromReference,
  invoiceReference,
} from '../../../src/modules/crm/invoicing/invoice-gateway-settler';

const gateway = (slug: string, credentials: Record<string, string> = {}): ResolvedGateway => ({
  source: 'workspace_default',
  slug,
  name: slug,
  mode: 'live',
  credentials,
  storefrontId: 0,
  gatewayUuid: '11111111-1111-4111-8111-111111111111',
});

const request = {
  reference: 'WAORD-7',
  amountMinor: 50000n,
  currency: 'inr',
  description: 'Order #7',
  customerName: 'Asha',
  callbackUrl: 'https://shop.test/s/x/order/t',
  notes: { wa_order_id: '7' },
};

function service(opts: { driver?: Partial<PaymentDriver>; razorpay?: Partial<RazorpayPort> } = {}) {
  const calls: { driver: unknown[]; razorpay: unknown[] } = { driver: [], razorpay: [] };
  const resolver = {
    driverFor: () =>
      ({
        initiate: async (...args: unknown[]) => {
          calls.driver.push(args);
          return opts.driver?.initiate
            ? opts.driver.initiate(...(args as [never, never]))
            : { status: 'pending' };
        },
      }) as unknown as PaymentDriver,
    webhookUrl: (id: string) => `https://api.test/hook/${id}`,
  } as unknown as WorkspaceGatewayResolver;
  const razorpay: RazorpayPort = {
    createPaymentLink: async (...args) => {
      calls.razorpay.push(args);
      return opts.razorpay?.createPaymentLink
        ? opts.razorpay.createPaymentLink(...args)
        : { shortUrl: 'https://rzp.test/l/1', id: 'plink_1' };
    },
  };
  return { svc: new GatewayLinkService(resolver, razorpay), calls };
}

describe('GatewayLinkService: a hosted link on whichever gateway the workspace resolved', () => {
  it('Razorpay goes through its Payment Links API with our reference and notes', async () => {
    const { svc, calls } = service();
    const link = await svc.mint(gateway('razorpay', { key_id: 'rzp_1', key_secret: 's' }), request);
    expect(link).toEqual({ url: 'https://rzp.test/l/1', id: 'plink_1' });
    const [creds, body] = calls.razorpay[0] as [Record<string, string>, Record<string, unknown>];
    expect(creds).toEqual({ keyId: 'rzp_1', keySecret: 's' });
    expect(body).toMatchObject({
      amountMinor: 50000,
      currency: 'inr',
      referenceId: 'WAORD-7',
      notes: { wa_order_id: '7' },
      callbackUrl: 'https://shop.test/s/x/order/t',
    });
    expect(calls.driver).toHaveLength(0);
  });

  it("a total under Razorpay's minimum, or a refusal by Razorpay, gives no link", async () => {
    expect(
      await service().svc.mint(gateway('razorpay'), { ...request, amountMinor: 99n }),
    ).toBeNull();
    const refused = service({ razorpay: { createPaymentLink: async () => null } });
    expect(await refused.svc.mint(gateway('razorpay'), request)).toBeNull();
  });

  it('another gateway goes through its driver and must answer a redirect', async () => {
    const ok = service({
      driver: {
        initiate: async () => ({
          status: 'pending',
          redirectUrl: 'https://pay.test/x',
          gatewayOrderId: 'cs_1',
        }),
      },
    });
    expect(await ok.svc.mint(gateway('stripe'), request)).toEqual({
      url: 'https://pay.test/x',
      id: 'cs_1',
    });
    const [order, urls] = ok.calls.driver[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(order).toMatchObject({
      orderNumber: 'WAORD-7',
      amountMinor: 50000n,
      amountMajor: '500.00',
      currency: 'INR',
    });
    expect(urls).toEqual({
      returnUrl: 'https://shop.test/s/x/order/t',
      notifyUrl: 'https://api.test/hook/11111111-1111-4111-8111-111111111111',
    });

    // A widget (no redirect) cannot be sent as a link.
    const widget = service({
      driver: {
        initiate: async () => ({
          status: 'pending',
          clientAction: { provider: 'cashfree', params: {} },
        }),
      },
    });
    expect(await widget.svc.mint(gateway('stripe'), request)).toBeNull();
    const failed = service({
      driver: { initiate: async () => ({ status: 'failed', error: 'stripe_exception' }) },
    });
    expect(await failed.svc.mint(gateway('stripe'), request)).toBeNull();
  });

  it('a gateway that cannot make a link is not even tried', async () => {
    const { svc, calls } = service();
    expect(await svc.mint(gateway('payu'), request)).toBeNull();
    expect(await svc.mint(gateway('bank_transfer'), request)).toBeNull();
    expect(calls.driver).toHaveLength(0);
    expect(calls.razorpay).toHaveLength(0);
  });
});

describe('Razorpay payment_link.paid', () => {
  const event = (over: Record<string, unknown> = {}) => ({
    event: 'payment_link.paid',
    payload: {
      payment_link: {
        entity: {
          id: 'plink_1',
          reference_id: 'INV-abc',
          amount: 4000,
          currency: 'inr',
          short_url: 'https://rzp.io/i/x',
          ...over,
        },
      },
      payment: { entity: { id: 'pay_1' } },
    },
  });

  it('reads our reference, the amount, the currency and the payment id', () => {
    expect(parseRazorpayLinkPaid(event())).toEqual({
      orderNumber: 'INV-abc',
      gatewayOrderId: 'plink_1',
      gatewayPaymentId: 'pay_1',
      amountMinor: 4000n,
      currency: 'INR',
      payload: { razorpay_link: 'https://rzp.io/i/x' },
    });
  });

  it('is null for any other event, and says no amount when there is none', () => {
    expect(parseRazorpayLinkPaid({ event: 'payment.captured' })).toBeNull();
    expect(parseRazorpayLinkPaid(null)).toBeNull();
    expect(parseRazorpayLinkPaid(event({ amount: 'lots' }))?.amountMinor).toBeUndefined();
  });
});

describe('who settles a reference', () => {
  it('routes by prefix, and an unknown prefix goes nowhere', () => {
    const registry = new GatewayPaymentRegistry();
    const store = { prefix: 'WAORD-', settle: async () => ({ outcome: 'store' }) };
    const inv = { prefix: 'INV-', settle: async () => ({ outcome: 'inv' }) };
    registry.register(store);
    registry.register(inv);
    expect(registry.forReference('WAORD-12')).toBe(store);
    expect(registry.forReference('INV-1234')).toBe(inv);
    expect(registry.forReference('SOMETHING-1')).toBeUndefined();
    expect(registry.forReference('')).toBeUndefined();
  });

  it('an invoice reference carries the attempt uuid and nothing else is accepted', () => {
    const id = '7e57d1b6-0000-4000-8000-00000000abcd';
    expect(invoiceReference(id)).toBe(`INV-${id}`);
    expect(attemptFromReference(`INV-${id}`)).toBe(id);
    expect(attemptFromReference(`INV-${id.toUpperCase()}`)).toBe(id);
    for (const bad of ['', 'INV-', 'INV-12', `WAORD-${id}`, `INV-${id}x`, `inv-${id}`]) {
      expect(attemptFromReference(bad), bad).toBeNull();
    }
  });
});
