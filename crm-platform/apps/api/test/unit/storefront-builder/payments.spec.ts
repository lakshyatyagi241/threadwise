import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { RazorpayLiveAdapter } from '../../../src/infra/providers/storefront-builder/razorpay-live.adapter';
import {
  RazorpayFixtureAdapter,
  fixtureRazorpayCalls,
} from '../../../src/infra/providers/storefront-builder/razorpay-fixture.adapter';
import {
  basicAuthHeader,
  buildPaymentLinkBody,
  signRazorpayBody,
  verifyRazorpaySignature,
} from '../../../src/infra/providers/storefront-builder/razorpay-payloads';
import {
  buildPaymentConfig,
  readRazorpayConfig,
  supportsLinks,
} from '../../../src/modules/storefront-builder/rules/payment-config';
import { StorefrontPaymentService } from '../../../src/modules/storefront-builder/payments/storefront-payment.service';
import { CryptoService } from '../../../src/common/crypto/crypto.service';

const enc = (s: string) => `enc(${s})`;
const dec = (s: string) => {
  const m = /^enc\((.*)\)$/.exec(s);
  if (!m) throw new Error('bad');
  return m[1]!;
};

describe('payment config (WD-STORE-008)', () => {
  it('stores the typed secrets encrypted and the key id plain', () => {
    const cfg = buildPaymentConfig(
      {
        provider: 'razorpay_api',
        rzpKeyId: 'rzp_live_1',
        rzpKeySecret: 'sec',
        rzpWebhookSecret: 'whs',
      },
      null,
      enc,
    );
    expect(cfg).toEqual({
      key_id: 'rzp_live_1',
      key_secret: 'enc(sec)',
      webhook_secret: 'enc(whs)',
    });
    expect(cfg!.key_secret).not.toBe('sec');
  });

  it('blank fields keep the stored values; a typed one replaces; nothing can be cleared through the form', () => {
    const stored = { key_id: 'rzp_live_1', key_secret: 'enc(old)', webhook_secret: 'enc(oldwh)' };
    expect(
      buildPaymentConfig(
        { provider: 'razorpay_api', rzpKeyId: '', rzpKeySecret: '', rzpWebhookSecret: '' },
        stored,
        enc,
      ),
    ).toEqual(stored);
    expect(
      buildPaymentConfig(
        { provider: 'razorpay_api', rzpKeyId: ' rzp_live_2 ', rzpKeySecret: 'new' },
        stored,
        enc,
      ),
    ).toEqual({ key_id: 'rzp_live_2', key_secret: 'enc(new)', webhook_secret: 'enc(oldwh)' });
  });

  it('switching the provider away drops the Razorpay keys; a static provider stores only the handle', () => {
    const stored = { key_id: 'k', key_secret: 'enc(a)', webhook_secret: 'enc(b)' };
    expect(buildPaymentConfig({ provider: 'upi', handle: 'shop@upi' }, stored, enc)).toEqual({
      handle: 'shop@upi',
    });
    expect(buildPaymentConfig({ provider: 'upi', handle: '' }, stored, enc)).toBeNull();
    expect(buildPaymentConfig({ provider: null }, stored, enc)).toBeNull();
  });

  it('reads the secrets back; an unreadable one is empty so nothing is minted or verified', () => {
    const creds = readRazorpayConfig(
      { key_id: 'k', key_secret: 'enc(s)', webhook_secret: 'garbage' },
      dec,
    );
    expect(creds).toEqual({ keyId: 'k', keySecret: 's', webhookSecret: '' });
    expect(supportsLinks('razorpay_api', creds)).toBe(true);
    expect(supportsLinks('razorpay_api', { ...creds, keySecret: '' })).toBe(false);
    expect(supportsLinks('upi', creds)).toBe(false);
  });
});

describe('Razorpay payment link (WD-STORE-018), recorded fixture', () => {
  const request = {
    amountMinor: 5000,
    currency: 'inr',
    referenceId: 'WAORD-77',
    description: 'Order #77 · Acme',
    customer: { name: 'Asha', contact: '+919812345678', email: null },
    notes: { wa_order_id: '77', storefront_id: '12', workspace_id: '3' },
    callbackUrl: 'https://app.example.com/s/acme/order/tok',
  };

  it('sends the body Razorpay documents: amount, currency, reference, notes, no partial pay, own notifications off', () => {
    expect(buildPaymentLinkBody(request)).toEqual({
      amount: 5000,
      currency: 'INR',
      accept_partial: false,
      reference_id: 'WAORD-77',
      description: 'Order #77 · Acme',
      customer: { name: 'Asha', contact: '+919812345678' },
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: { wa_order_id: '77', storefront_id: '12', workspace_id: '3' },
      callback_url: 'https://app.example.com/s/acme/order/tok',
      callback_method: 'get',
    });
  });

  it('the live adapter POSTs it with basic auth to /payment_links and returns the short url and id', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'plink_abc', short_url: 'https://rzp.io/i/abc' }), {
          status: 200,
        }),
    );
    const adapter = new RazorpayLiveAdapter(
      'https://api.razorpay.test/v1',
      fetchImpl as unknown as typeof fetch,
    );
    const link = await adapter.createPaymentLink(
      { keyId: 'rzp_live_1', keySecret: 'sec' },
      request,
    );
    expect(link).toEqual({ shortUrl: 'https://rzp.io/i/abc', id: 'plink_abc' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.test/v1/payment_links');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(
      basicAuthHeader('rzp_live_1', 'sec'),
    );
    expect(JSON.parse(init.body as string).reference_id).toBe('WAORD-77');
  });

  it('a non-2xx answer, bad JSON and a network error all give null', async () => {
    const bad = new RazorpayLiveAdapter(
      'http://x',
      (async () =>
        new Response(JSON.stringify({ error: { description: 'Authentication failed' } }), {
          status: 401,
        })) as typeof fetch,
    );
    expect(await bad.createPaymentLink({ keyId: 'k', keySecret: 's' }, request)).toBeNull();
    const down = new RazorpayLiveAdapter('http://x', (async () => {
      throw new Error('boom');
    }) as typeof fetch);
    expect(await down.createPaymentLink({ keyId: 'k', keySecret: 's' }, request)).toBeNull();
  });

  it('the fixture adapter is deterministic and can simulate rejected keys', async () => {
    const f = new RazorpayFixtureAdapter();
    expect(await f.createPaymentLink({ keyId: 'rzp_test', keySecret: 's' }, request)).toEqual({
      shortUrl: 'https://rzp.fixture.test/l/WAORD-77',
      id: 'plink_WAORD-77',
    });
    expect(await f.createPaymentLink({ keyId: 'rzp_fail_1', keySecret: 's' }, request)).toBeNull();
    expect(fixtureRazorpayCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('the signature is the HMAC-SHA256 hex of the raw body; wrong, missing or secretless never verifies', () => {
    const body = Buffer.from('{"event":"payment_link.paid"}');
    const good = createHmac('sha256', 'whsec').update(body).digest('hex');
    expect(signRazorpayBody(body, 'whsec')).toBe(good);
    expect(verifyRazorpaySignature(body, good, 'whsec')).toBe(true);
    expect(verifyRazorpaySignature(body, good.toUpperCase(), 'whsec')).toBe(true);
    expect(verifyRazorpaySignature(body, good, 'other')).toBe(false);
    expect(verifyRazorpaySignature(body, 'deadbeef', 'whsec')).toBe(false);
    expect(verifyRazorpaySignature(body, undefined, 'whsec')).toBe(false);
    expect(verifyRazorpaySignature(body, good, '')).toBe(false);
    expect(verifyRazorpaySignature(Buffer.from('{"event":"x"}'), good, 'whsec')).toBe(false);
  });
});

describe('StorefrontPaymentService.mintLink', () => {
  const crypto = { encrypt: enc, decrypt: dec } as unknown as CryptoService;
  const calls: Array<{ amountMinor: number; notes: Record<string, string>; referenceId: string }> =
    [];
  const port = {
    createPaymentLink: async (
      _c: unknown,
      r: { amountMinor: number; notes: Record<string, string>; referenceId: string },
    ) => {
      calls.push(r);
      return { shortUrl: 'https://rzp/x', id: 'plink_1' };
    },
  };
  const svc = new StorefrontPaymentService(crypto, port);
  const shop = {
    id: 12,
    orgId: 3,
    shopName: 'Acme',
    paymentProvider: 'razorpay_api',
    paymentConfig: { key_id: 'rzp_live_1', key_secret: 'enc(s)', webhook_secret: 'enc(w)' },
  };
  const order = (totalMinor: number) => ({
    id: 77,
    totalMinor,
    currencyCode: 'INR',
    customerName: 'Asha',
  });

  it('a 50.00 order mints with amount 5000, reference WAORD-<id> and the ids in the notes', async () => {
    const link = await svc.mintLink(shop, order(5000), 'https://app/s/acme/order/t');
    expect(link).toEqual({ shortUrl: 'https://rzp/x', id: 'plink_1' });
    expect(calls.at(-1)).toMatchObject({
      amountMinor: 5000,
      referenceId: 'WAORD-77',
      notes: { wa_order_id: '77', storefront_id: '12', workspace_id: '3' },
    });
  });

  it('0.50 (under the 100 minor minimum), a missing secret or another provider mint nothing', async () => {
    const before = calls.length;
    expect(await svc.mintLink(shop, order(50), 'u')).toBeNull();
    expect(
      await svc.mintLink({ ...shop, paymentConfig: { key_id: 'k' } }, order(5000), 'u'),
    ).toBeNull();
    expect(await svc.mintLink({ ...shop, paymentProvider: 'upi' }, order(5000), 'u')).toBeNull();
    expect(calls.length).toBe(before);
  });

  it('webhook verification uses the shop webhook secret and a shop without one fails closed', () => {
    const body = Buffer.from('{}');
    const sig = signRazorpayBody(body, 'w');
    expect(svc.verifyWebhook(shop, body, sig)).toBe(true);
    expect(
      svc.verifyWebhook(
        { ...shop, paymentConfig: { key_id: 'k', key_secret: 'enc(s)' } },
        body,
        sig,
      ),
    ).toBe(false);
  });
});
