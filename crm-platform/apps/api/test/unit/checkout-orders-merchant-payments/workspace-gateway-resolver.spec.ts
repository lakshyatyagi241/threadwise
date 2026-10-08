import { describe, expect, it } from 'vitest';
import type { CryptoService } from '../../../src/common/crypto/crypto.service';
import type { DatabaseService } from '../../../src/infra/db/database.service';
import type { HttpFetch } from '../../../src/infra/providers/platform-payment-gateways';
import type {
  GatewayRow,
  MerchantGatewaysRepository,
} from '../../../src/modules/checkout-orders-merchant-payments/gateways/merchant-gateways.repository';
import { WorkspaceGatewayResolver } from '../../../src/modules/checkout-orders-merchant-payments/gateways/workspace-gateway.resolver';

// The crypto double: `enc:` + the plain text. Decrypting anything else throws, like a key that was rotated away.
const crypto = {
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => {
    if (!s.startsWith('enc:')) throw new Error('cannot decrypt');
    return s.slice(4);
  },
} as unknown as CryptoService;

const config = { get: () => 'http://api.test' } as never;
const http: HttpFetch = async () => ({ status: 200, json: {}, text: '{}' });

const envelope = (creds: Record<string, string>) => crypto.encrypt(JSON.stringify(creds));

let seq = 0;
const gw = (o: Partial<GatewayRow> & { slug: string }): GatewayRow => ({
  id: ++seq,
  uuid: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
  orgId: 1,
  storefrontId: 0,
  storefrontUuid: null,
  storefrontName: null,
  credentials: null,
  mode: 'live',
  active: true,
  isDefault: false,
  sortOrder: 0,
  meta: null,
  rowVersion: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

const RZP = { key_id: 'rzp_live_1', key_secret: 'secret', webhook_secret: 'whsec' };
const STRIPE = { secret_key: 'sk_live_1', webhook_secret: 'whsec_1' };

function resolverWith(
  rows: GatewayRow[],
  shop?: { paymentProvider: string | null; paymentConfig: Record<string, unknown> | null },
) {
  const repo = {
    list: async (_tx: unknown, _org: number, scope?: number) =>
      rows.filter((r) => scope === undefined || r.storefrontId === 0 || r.storefrontId === scope),
    legacyShopPayment: async () => shop,
  } as unknown as MerchantGatewaysRepository;
  const db = {
    txAs: async (_t: unknown, fn: (tx: unknown) => unknown) => fn({}),
  } as unknown as DatabaseService;
  return new WorkspaceGatewayResolver(db, repo, crypto, config, http);
}

describe('WorkspaceGatewayResolver.resolve: store override > workspace default > shop keys > none', () => {
  it('a shop override beats the workspace default, and says where it came from', async () => {
    const r = resolverWith([
      gw({ slug: 'stripe', credentials: envelope(STRIPE) }),
      gw({ slug: 'razorpay', storefrontId: 7, credentials: envelope(RZP) }),
    ]);
    const hit = await r.resolve(1, 7);
    expect(hit).toMatchObject({ source: 'store_override', slug: 'razorpay', storefrontId: 7 });
    expect(hit?.credentials.key_secret).toBe('secret');
  });

  it('another shop, and an invoice with no shop, use the workspace default', async () => {
    const r = resolverWith([
      gw({ slug: 'stripe', credentials: envelope(STRIPE) }),
      gw({ slug: 'razorpay', storefrontId: 7, credentials: envelope(RZP) }),
    ]);
    expect((await r.resolve(1, 8))?.source).toBe('workspace_default');
    expect((await r.resolve(1))?.slug).toBe('stripe');
    expect((await r.resolve(1, null))?.slug).toBe('stripe');
  });

  it('the workspace default flag picks between several workspace gateways', async () => {
    const r = resolverWith([
      gw({ slug: 'stripe', credentials: envelope(STRIPE), sortOrder: 0 }),
      gw({ slug: 'razorpay', credentials: envelope(RZP), sortOrder: 9, isDefault: true }),
    ]);
    expect((await r.resolve(1))?.slug).toBe('razorpay');
    expect((await r.resolve(1, undefined, { slug: 'stripe' }))?.slug).toBe('stripe');
  });

  it('a disabled or half-configured override does not win', async () => {
    const r = resolverWith([
      gw({ slug: 'stripe', credentials: envelope(STRIPE) }),
      gw({ slug: 'razorpay', storefrontId: 7, active: false, credentials: envelope(RZP) }),
    ]);
    expect((await r.resolve(1, 7))?.source).toBe('workspace_default');
    const half = resolverWith([
      gw({ slug: 'razorpay', storefrontId: 7, credentials: envelope({ key_id: 'only' }) }),
    ]);
    expect(await half.resolve(1, 7)).toBeNull();
  });

  it('falls back to the keys saved on the shop when nothing else is configured', async () => {
    const r = resolverWith([], {
      paymentProvider: 'razorpay_api',
      paymentConfig: {
        key_id: 'rzp_old',
        key_secret: 'enc:old-secret',
        webhook_secret: 'enc:old-hook',
      },
    });
    const hit = await r.resolve(1, 7);
    expect(hit).toMatchObject({ source: 'legacy_storefront', slug: 'razorpay', gatewayUuid: null });
    expect(hit?.credentials).toEqual({
      key_id: 'rzp_old',
      key_secret: 'old-secret',
      webhook_secret: 'old-hook',
    });
    // An invoice has no shop: the shop's keys are not its gateway.
    expect(await r.resolve(1)).toBeNull();
  });

  it('shop keys of a shop not set to razorpay_api are not a gateway', async () => {
    const r = resolverWith([], { paymentProvider: 'upi', paymentConfig: { handle: 'me@upi' } });
    expect(await r.resolve(1, 7)).toBeNull();
  });

  it('reads a row copied by the data migration (credentials null, field-by-field ciphertext in meta.legacy)', async () => {
    const r = resolverWith([
      gw({
        slug: 'razorpay',
        storefrontId: 7,
        credentials: null,
        meta: {
          migratedFromStorefront: true,
          legacy: { key_id: 'rzp_m', key_secret: 'enc:ms', webhook_secret: 'enc:mw' },
        },
      }),
    ]);
    const hit = await r.resolve(1, 7);
    expect(hit?.source).toBe('store_override');
    expect(hit?.credentials).toEqual({ key_id: 'rzp_m', key_secret: 'ms', webhook_secret: 'mw' });
  });

  it('a blob that cannot be decrypted is not usable (fail closed)', async () => {
    const r = resolverWith([gw({ slug: 'stripe', credentials: 'not-a-blob' })]);
    expect(await r.resolve(1)).toBeNull();
  });

  it('nothing at all resolves to null', async () => {
    expect(await resolverWith([]).resolve(1, 7)).toBeNull();
  });
});

describe('WorkspaceGatewayResolver.available', () => {
  it('lists the winner of each gateway, the shop override first', async () => {
    const r = resolverWith([
      gw({ slug: 'razorpay', credentials: envelope({ ...RZP, key_id: 'workspace_key' }) }),
      gw({ slug: 'razorpay', storefrontId: 7, credentials: envelope(RZP) }),
      gw({ slug: 'stripe', credentials: envelope(STRIPE) }),
    ]);
    const list = await r.available(1, 7);
    expect(list.map((g) => [g.slug, g.source])).toEqual([
      ['razorpay', 'store_override'],
      ['stripe', 'workspace_default'],
    ]);
    expect(list[0]?.credentials.key_id).toBe('rzp_live_1');
  });

  it('includes the shop keys as razorpay when no row covers it', async () => {
    const r = resolverWith([gw({ slug: 'stripe', credentials: envelope(STRIPE) })], {
      paymentProvider: 'razorpay_api',
      paymentConfig: { key_id: 'rzp_old', key_secret: 'enc:s' },
    });
    expect((await r.available(1, 7)).map((g) => g.slug).sort()).toEqual(['razorpay', 'stripe']);
  });
});

describe('WorkspaceGatewayResolver.driverFor', () => {
  it('builds the shared driver library adapter with the merchant keys and the gateway webhook address', async () => {
    const r = resolverWith([gw({ slug: 'stripe', credentials: envelope(STRIPE) })]);
    const hit = (await r.resolve(1))!;
    const driver = r.driverFor(hit);
    expect(driver.slug).toBe('stripe');
    expect(r.webhookUrl(hit.gatewayUuid!)).toBe(
      `http://api.test/v2/store-public/webhooks/gateway/${hit.gatewayUuid}`,
    );
  });
});
