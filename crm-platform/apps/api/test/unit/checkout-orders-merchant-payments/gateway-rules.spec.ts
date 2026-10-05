import { describe, expect, it } from 'vitest';
import {
  chooseGateway,
  decodeLegacyRazorpay,
  isConfigured,
  maskCredential,
  mergeCredentials,
  missingRequired,
  pickRow,
  supportsPaymentLinks,
  toDriverMode,
  webhookSecretMissing,
  type GatewayCandidate,
} from '../../../src/modules/checkout-orders-merchant-payments/gateways/gateway-rules';

const row = (o: Partial<GatewayCandidate> & { id: number }): GatewayCandidate => ({
  storefrontId: 0,
  slug: 'razorpay',
  active: true,
  isDefault: false,
  sortOrder: 0,
  configured: true,
  ...o,
});

describe('credential masking', () => {
  it('shows nothing for a missing or blank value', () => {
    expect(maskCredential(undefined)).toBeNull();
    expect(maskCredential('')).toBeNull();
    expect(maskCredential('   ')).toBeNull();
  });

  it('hides a short value completely', () => {
    expect(maskCredential('abc123')).toBe('••••••••');
  });

  it('keeps only the last four characters of a long value', () => {
    const masked = maskCredential('sk_live_51Habcdefgh1234');
    expect(masked).toBe('••••••••1234');
    expect(masked).not.toContain('sk_live');
  });
});

describe('credential merge', () => {
  it('a blank field keeps the stored secret and a typed one replaces it', () => {
    const out = mergeCredentials(
      'razorpay',
      { key_id: 'rzp_live_1', key_secret: 'old' },
      { key_id: ' ', key_secret: ' new ' },
      undefined,
    );
    expect(out.merged).toEqual({ key_id: 'rzp_live_1', key_secret: 'new' });
    expect(out.keysSet).toEqual(['key_secret']);
  });

  it('refuses keys the gateway does not declare instead of storing them', () => {
    const out = mergeCredentials('razorpay', {}, { key_id: 'a', evil: 'x' }, ['also_evil']);
    expect(out.merged).toEqual({ key_id: 'a' });
    expect(out.unknown).toEqual(['evil', 'also_evil']);
  });

  it('removes a credential only when it is named in clear', () => {
    const out = mergeCredentials(
      'razorpay',
      { key_id: 'a', key_secret: 'b', webhook_secret: 'c' },
      {},
      ['webhook_secret'],
    );
    expect(out.merged).toEqual({ key_id: 'a', key_secret: 'b' });
    expect(out.keysCleared).toEqual(['webhook_secret']);
  });
});

describe('what makes a gateway usable', () => {
  it('needs every required field', () => {
    expect(missingRequired('razorpay', { key_id: 'a' })).toEqual(['key_secret']);
    expect(isConfigured('razorpay', { key_id: 'a', key_secret: 'b' })).toBe(true);
    expect(isConfigured('razorpay', { key_id: 'a' })).toBe(false);
  });

  it('flags a gateway whose signing secret is empty', () => {
    expect(webhookSecretMissing('razorpay', { key_id: 'a', key_secret: 'b' })).toBe(true);
    expect(webhookSecretMissing('razorpay', { webhook_secret: 'w' })).toBe(false);
  });

  it('maps the screen mode to the driver mode', () => {
    expect(toDriverMode('test')).toBe('sandbox');
    expect(toDriverMode('live')).toBe('live');
  });

  it('knows which gateways can send a link a buyer opens from WhatsApp', () => {
    expect(supportsPaymentLinks('razorpay')).toBe(true);
    expect(supportsPaymentLinks('stripe')).toBe(true);
    expect(supportsPaymentLinks('payu')).toBe(false);
    expect(supportsPaymentLinks('bank_transfer')).toBe(false);
    expect(supportsPaymentLinks('no_such_gateway')).toBe(false);
  });
});

describe('which row of a scope wins', () => {
  it('the default, then the lowest sort order, then the oldest', () => {
    const rows = [
      row({ id: 3, slug: 'stripe', sortOrder: 0 }),
      row({ id: 2, slug: 'paypal', sortOrder: 5 }),
      row({ id: 1, slug: 'razorpay', sortOrder: 5, isDefault: true }),
    ];
    expect(pickRow(rows, 0)?.id).toBe(1);
    expect(
      pickRow(
        rows.map((r) => ({ ...r, isDefault: false })),
        0,
      )?.id,
    ).toBe(3);
    expect(
      pickRow(
        rows.filter((r) => r.id !== 3).map((r) => ({ ...r, isDefault: false })),
        0,
      )?.id,
    ).toBe(1);
  });

  it('skips rows that are off or half-configured', () => {
    const rows = [
      row({ id: 1, isDefault: true, active: false }),
      row({ id: 2, isDefault: true, configured: false }),
      row({ id: 3 }),
    ];
    expect(pickRow(rows, 0)?.id).toBe(3);
  });

  it('narrows to the gateway asked for', () => {
    const rows = [
      row({ id: 1, slug: 'razorpay', isDefault: true }),
      row({ id: 2, slug: 'stripe' }),
    ];
    expect(pickRow(rows, 0, 'stripe')?.id).toBe(2);
    expect(pickRow(rows, 0, 'paypal')).toBeNull();
  });
});

describe('gateway precedence: store override > workspace default > shop keys > none', () => {
  const workspace = row({ id: 10, storefrontId: 0, slug: 'stripe' });
  const own = row({ id: 11, storefrontId: 7, slug: 'razorpay' });
  const legacy = { slug: 'razorpay' as const };

  it('a shop override beats the workspace default', () => {
    expect(chooseGateway([workspace, own], 7, legacy)).toEqual({
      source: 'store_override',
      row: own,
    });
  });

  it('another shop falls through to the workspace default', () => {
    expect(chooseGateway([workspace, own], 8, legacy)).toEqual({
      source: 'workspace_default',
      row: workspace,
    });
  });

  it('a disabled override falls through to the workspace default', () => {
    const off = { ...own, active: false };
    expect(chooseGateway([workspace, off], 7, legacy)?.source).toBe('workspace_default');
  });

  it('the keys saved on the shop come after both', () => {
    expect(chooseGateway([], 7, legacy)).toEqual({ source: 'legacy_storefront', row: null });
    expect(chooseGateway([workspace], 7, legacy)?.source).toBe('workspace_default');
  });

  it('nothing configured is none, and an invoice (no shop) never uses a shop key', () => {
    expect(chooseGateway([], 7, null)).toBeNull();
    expect(chooseGateway([], null, legacy)).toBeNull();
  });

  it('an invoice (no shop) reads the workspace default only', () => {
    expect(chooseGateway([workspace, own], null, legacy)).toEqual({
      source: 'workspace_default',
      row: workspace,
    });
  });

  it('naming a gateway skips the ones that are not it, including the shop keys', () => {
    expect(chooseGateway([workspace, own], 7, legacy, 'stripe')?.source).toBe('workspace_default');
    expect(chooseGateway([], 7, legacy, 'stripe')).toBeNull();
    expect(chooseGateway([], 7, legacy, 'razorpay')?.source).toBe('legacy_storefront');
  });
});

describe('the shop keys as the settings page stored them', () => {
  const dec = (s: string) => {
    if (!s.startsWith('enc:')) throw new Error('bad blob');
    return s.slice(4);
  };

  it('the key id is plain, the two secrets are decrypted', () => {
    expect(
      decodeLegacyRazorpay({ key_id: 'rzp_1', key_secret: 'enc:s', webhook_secret: 'enc:w' }, dec),
    ).toEqual({ key_id: 'rzp_1', key_secret: 's', webhook_secret: 'w' });
  });

  it('a secret that cannot be decrypted reads as missing, so the gateway is not usable (fail closed)', () => {
    const creds = decodeLegacyRazorpay({ key_id: 'rzp_1', key_secret: 'garbage' }, dec);
    expect(creds).toEqual({ key_id: 'rzp_1' });
    expect(isConfigured('razorpay', creds)).toBe(false);
  });

  it('nothing stored is nothing', () => {
    expect(decodeLegacyRazorpay(null, dec)).toEqual({});
  });
});
