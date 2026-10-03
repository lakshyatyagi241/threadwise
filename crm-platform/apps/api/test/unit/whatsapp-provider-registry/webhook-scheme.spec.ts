import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  verifyPayloadProviders,
  verifyProviderDelivery,
  type Delivery,
  type DeliveryProvider,
} from '../../../src/modules/whatsapp-provider-registry';

const BODY = '{"object":"whatsapp_business_account"}';
const sign = (secret: string) =>
  `sha256=${createHmac('sha256', secret).update(BODY).digest('hex')}`;

/** The platform's own verifier (WHATSAPP_PROVIDER.verifyWebhookSignature) in a few lines. */
const matches = (header: string, secret: string) => header === sign(secret);

const delivery = (headers: Record<string, string>, urlKeyValid = false): Delivery => ({
  header: (n) => headers[n],
  urlKeyValid,
  signatureMatches: matches,
});

const provider = (over: Partial<DeliveryProvider> = {}): DeliveryProvider => ({
  key: 'pinnacle',
  signatureScheme: 'meta_app_secret_sha256',
  signatureHeaderName: null,
  ...over,
});

describe('meta_app_secret_sha256', () => {
  const p = provider({ appSecret: 'app-secret-1' });

  it('accepts a body signed with the provider’s own app secret', () => {
    expect(
      verifyProviderDelivery(p, delivery({ 'x-hub-signature-256': sign('app-secret-1') })),
    ).toEqual({
      ok: true,
      via: 'signature',
    });
  });

  it('refuses a wrong signature, a missing one, and the URL secret alone (unsigned is rejected by default)', () => {
    expect(verifyProviderDelivery(p, delivery({ 'x-hub-signature-256': sign('other') })).ok).toBe(
      false,
    );
    expect(verifyProviderDelivery(p, delivery({})).ok).toBe(false);
    expect(verifyProviderDelivery(p, delivery({}, true)).ok).toBe(false);
  });

  it('a provider with no stored app secret verifies nothing', () => {
    const r = verifyProviderDelivery(
      provider(),
      delivery({ 'x-hub-signature-256': sign('anything') }),
    );
    expect(r).toEqual({ ok: false, reason: 'pinnacle: no app secret stored' });
  });
});

describe('shared_secret_header', () => {
  const p = provider({
    signatureScheme: 'shared_secret_header',
    signatureHeaderName: 'X-Bsp-Secret',
    webhookSecret: 'whsec-123456',
  });

  it('accepts the secret in the configured header, whatever the case of the name', () => {
    expect(verifyProviderDelivery(p, delivery({ 'x-bsp-secret': 'whsec-123456' }))).toEqual({
      ok: true,
      via: 'shared_secret',
    });
  });

  it('refuses a wrong or missing secret, and a provider without the header configured or without a stored secret', () => {
    expect(verifyProviderDelivery(p, delivery({ 'x-bsp-secret': 'whsec-000000' })).ok).toBe(false);
    expect(verifyProviderDelivery(p, delivery({})).ok).toBe(false);
    expect(
      verifyProviderDelivery(
        { ...p, signatureHeaderName: null },
        delivery({ 'x-bsp-secret': 'whsec-123456' }),
      ).ok,
    ).toBe(false);
    expect(
      verifyProviderDelivery({ ...p, webhookSecret: undefined }, delivery({ 'x-bsp-secret': 'x' }))
        .ok,
    ).toBe(false);
  });
});

describe('none', () => {
  const p = provider({ signatureScheme: 'none' });

  it('relies on the URL secret of the callback we registered, and on nothing else', () => {
    expect(verifyProviderDelivery(p, delivery({}, true))).toEqual({ ok: true, via: 'url_key' });
    expect(verifyProviderDelivery(p, delivery({}, false)).ok).toBe(false);
  });
});

describe('a payload with several providers', () => {
  it('has nothing to add when no number is on a registry provider', () => {
    expect(verifyPayloadProviders([], delivery({}))).toBeNull();
  });

  it('every provider must be satisfied; the first refusal is the answer', () => {
    const a = provider({ key: 'a', appSecret: 'sec-aaaaaaaa' });
    const b = provider({ key: 'b', appSecret: 'sec-bbbbbbbb' });
    expect(
      verifyPayloadProviders([a, b], delivery({ 'x-hub-signature-256': sign('sec-aaaaaaaa') })),
    ).toEqual({
      ok: false,
      reason: 'b: invalid signature',
    });
    expect(
      verifyPayloadProviders([a], delivery({ 'x-hub-signature-256': sign('sec-aaaaaaaa') }))?.ok,
    ).toBe(true);
  });
});
