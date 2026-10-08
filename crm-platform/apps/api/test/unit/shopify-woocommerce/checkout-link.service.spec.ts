import { describe, expect, it, vi } from 'vitest';
import { CheckoutLinkService } from '../../../src/modules/shopify-woocommerce/checkout-link.service';
import { EcomFlowShop } from '../../../src/modules/shopify-woocommerce/ecom-flow-shop';
import type {
  ShopProductRow,
  ShopProductsRepository,
} from '../../../src/modules/shopify-woocommerce/shop-products.repository';
import type {
  ShopifyRow,
  StoresRepository,
  WooRow,
} from '../../../src/modules/shopify-woocommerce/stores.repository';
import type {
  CheckoutLine,
  ShopifyCheckoutApi,
  ShopifyFactory,
  WooFactory,
} from '../../../src/infra/providers/ecom/ecom.port';

const ORG = 5;
const STORE = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';

const product = (o: Partial<ShopProductRow> = {}): ShopProductRow => ({
  id: 7,
  sku: 'TEE-1',
  metaRetailerId: null,
  storeProductId: '900',
  inStock: true,
  availability: 'in stock',
  status: 'active',
  stockQty: null,
  reservedQty: 0,
  ...o,
});

const shopifyRow = (o: Partial<ShopifyRow> = {}): ShopifyRow =>
  ({
    id: 1,
    storeUrl: 'a.myshopify.com',
    accessToken: 'enc:tok',
    metadata: null,
    ...o,
  }) as ShopifyRow;
const wooRow = (o: Partial<WooRow> = {}): WooRow =>
  ({
    id: 2,
    storeUrl: 'https://w.test',
    consumerKey: 'enc:k',
    consumerSecret: 'enc:s',
    ...o,
  }) as WooRow;

function build(opts: { rows?: ShopProductRow[]; shopify?: Partial<ShopifyCheckoutApi> } = {}) {
  const db = { txAs: (_: unknown, fn: (t: unknown) => unknown) => Promise.resolve(fn({})) };
  const crypto = { decrypt: (s: string) => s.replace(/^enc:/, '') };
  const products = {
    byRetailerIds: vi.fn(() => Promise.resolve(opts.rows ?? [])),
  } as unknown as ShopProductsRepository;
  const calls = {
    sku: [] as string[],
    first: [] as string[],
    cart: [] as Array<{ token: string; lines: readonly CheckoutLine[]; note: string | null }>,
    draft: [] as Array<{ lines: readonly CheckoutLine[]; note: string | null }>,
    woo: [] as Array<{ items: unknown; flow: string | null }>,
  };
  const api: ShopifyCheckoutApi = {
    variantIdBySku: (sku) => {
      calls.sku.push(sku);
      return Promise.resolve(sku === 'MISSING' ? null : `v-${sku}`.replace(/\D/g, '') || '1');
    },
    firstVariantId: (id) => {
      calls.first.push(id);
      return Promise.resolve('4242');
    },
    createStorefrontCart: (token, lines, note) => {
      calls.cart.push({ token, lines, note });
      return Promise.resolve({ url: 'https://a.myshopify.com/cart/c/1', cartId: 'gid://cart/1' });
    },
    createDraftOrder: (lines, note) => {
      calls.draft.push({ lines, note });
      return Promise.resolve({ url: 'https://a.myshopify.com/invoices/1', draftId: '88' });
    },
    ...opts.shopify,
  };
  const shopify = { checkout: () => api } as unknown as ShopifyFactory;
  const woo = {
    store: () => ({
      createPendingOrder: (items: unknown, flow: string | null) => {
        calls.woo.push({ items, flow });
        return Promise.resolve({ url: 'https://w.test/pay/9', orderId: '9' });
      },
    }),
  } as unknown as WooFactory;
  const links = new CheckoutLinkService(db as never, crypto as never, products, shopify, woo);
  return { links, calls, db, products };
}

describe('CheckoutLinkService (TW-ECOM-036)', () => {
  it('Shopify with a Storefront token: a cart whose note carries the run', async () => {
    const { links, calls } = build({ rows: [product()] });
    const out = await links.shopifyLink(
      ORG,
      shopifyRow({ metadata: { storefrontAccessToken: 'sf' } }),
      [{ reference: 'TEE-1', qty: 2 }],
      RUN,
    );
    expect(out).toEqual({ url: 'https://a.myshopify.com/cart/c/1', ref: 'gid://cart/1' });
    expect(calls.cart).toEqual([
      { token: 'sf', lines: [{ variantId: '1', qty: 2 }], note: `threadwise-flow:${RUN}` },
    ]);
    expect(calls.draft).toEqual([]);
  });

  it('Shopify with no Storefront token: a draft order with the same note', async () => {
    const { links, calls } = build({ rows: [product()] });
    const out = await links.shopifyLink(ORG, shopifyRow(), [{ reference: 'TEE-1', qty: 1 }], RUN);
    expect(out?.url).toBe('https://a.myshopify.com/invoices/1');
    expect(calls.cart).toEqual([]);
    expect(calls.draft[0]?.note).toBe(`threadwise-flow:${RUN}`);
  });

  it('Shopify: a cart that fails falls back to a draft order', async () => {
    const { links, calls } = build({
      shopify: { createStorefrontCart: () => Promise.resolve(null) },
    });
    const out = await links.shopifyLink(
      ORG,
      shopifyRow({ metadata: { storefrontAccessToken: 'sf' } }),
      [{ reference: 'TEE-1', qty: 1 }],
      RUN,
    );
    expect(out?.ref).toBe('88');
    expect(calls.draft).toHaveLength(1);
  });

  it('Shopify: a product with no sku uses the first variant of its store product; a ref the mirror lacks is looked up as a sku', async () => {
    const { links, calls } = build({ rows: [product({ id: 3, sku: null, storeProductId: '31' })] });
    await links.shopifyLink(
      ORG,
      shopifyRow(),
      [
        { reference: 'wsn-3', qty: 1 },
        { reference: 'OTHER', qty: 1 },
      ],
      RUN,
    );
    expect(calls.first).toEqual(['31']);
    expect(calls.sku).toEqual(['OTHER']);
    expect(calls.draft[0]?.lines.map((l) => l.variantId)).toEqual(['4242', '1']);
  });

  it('Shopify: no variant found, an uninstalled store or no items make no link', async () => {
    const { links, calls } = build();
    expect(
      await links.shopifyLink(ORG, shopifyRow(), [{ reference: 'MISSING', qty: 1 }], RUN),
    ).toBeNull();
    expect(
      await links.shopifyLink(
        ORG,
        shopifyRow({ accessToken: '' }),
        [{ reference: 'A', qty: 1 }],
        RUN,
      ),
    ).toBeNull();
    expect(await links.shopifyLink(ORG, shopifyRow(), [], RUN)).toBeNull();
    expect(calls.cart.length + calls.draft.length).toBe(0);
  });

  it('Shopify: a throwing store is a null link, not an error', async () => {
    const { links } = build({
      rows: [product()],
      shopify: { createDraftOrder: () => Promise.reject(new Error('boom')) },
    });
    expect(
      await links.shopifyLink(ORG, shopifyRow(), [{ reference: 'TEE-1', qty: 1 }], RUN),
    ).toBeNull();
  });

  it('WooCommerce: a pending order tagged with the run; wsn ids become the sku or product id', async () => {
    const { links, calls } = build({ rows: [product({ id: 3, sku: null, storeProductId: '31' })] });
    const out = await links.wooLink(
      ORG,
      wooRow(),
      [
        { reference: 'wsn-3', qty: 2 },
        { reference: '555', qty: 500 },
      ],
      RUN,
    );
    expect(out).toEqual({ url: 'https://w.test/pay/9', ref: '9' });
    expect(calls.woo).toEqual([
      {
        items: [
          { reference: '31', qty: 2 },
          { reference: '555', qty: 99 },
        ],
        flow: RUN,
      },
    ]);
  });

  it('WooCommerce: a store without keys makes no link', async () => {
    const { links } = build();
    expect(
      await links.wooLink(ORG, wooRow({ consumerKey: '' }), [{ reference: 'a', qty: 1 }], RUN),
    ).toBeNull();
  });
});

describe('EcomFlowShop (TW-ECOM-036)', () => {
  function shop(rows: ShopProductRow[]) {
    const db = { txAs: (_: unknown, fn: (t: unknown) => unknown) => Promise.resolve(fn({})) };
    const products = {
      byRetailerIds: () => Promise.resolve(rows),
    } as unknown as ShopProductsRepository;
    const stores = {
      shopifyByUuid: vi.fn((_t: unknown, _o: number, uuid: string) =>
        Promise.resolve(uuid === STORE ? shopifyRow() : undefined),
      ),
      wooByUuid: vi.fn((_t: unknown, _o: number, uuid: string) =>
        Promise.resolve(uuid === STORE ? wooRow() : undefined),
      ),
    } as unknown as StoresRepository;
    const links = {
      shopifyLink: vi.fn(() => Promise.resolve({ url: 'https://s/1', ref: null })),
      wooLink: vi.fn(() => Promise.resolve({ url: 'https://w/1', ref: '1' })),
    };
    return { s: new EcomFlowShop(db as never, stores, products, links as never), links, stores };
  }

  it('offers what is in stock and what the mirror does not know; drops what is sold out', async () => {
    const { s } = shop([
      product({ id: 1, sku: 'IN' }),
      product({ id: 2, sku: 'OUT', inStock: false }),
    ]);
    const got = await s.inStock(ORG, {
      provider: 'shopify',
      storeId: STORE,
      retailerIds: ['IN', 'OUT', 'UNKNOWN'],
    });
    expect([...(got ?? [])].sort()).toEqual(['IN', 'UNKNOWN']);
  });

  it('says nothing about a WhatsApp catalog and never sends the native list', async () => {
    const { s } = shop([]);
    expect(
      await s.inStock(ORG, { provider: 'whatsapp_shop', storeId: 'x', retailerIds: ['a'] }),
    ).toBeNull();
    expect(
      await s.sendNative(ORG, {
        provider: 'whatsapp_shop',
        storeId: 'x',
        products: [],
        header: '',
        body: '',
        footer: '',
        peerKey: '1',
        runRef: RUN,
      }),
    ).toBe(false);
  });

  it('routes the link to the right store kind with the run, and refuses a bad or unknown store', async () => {
    const { s, links } = shop([]);
    const base = { storeId: STORE, retailerId: 'TEE-1', qty: 1, runRef: RUN, phone: '1' };
    expect(await s.checkoutLink(ORG, { ...base, provider: 'shopify' })).toBe('https://s/1');
    expect(await s.checkoutLink(ORG, { ...base, provider: 'woocommerce' })).toBe('https://w/1');
    expect(links.shopifyLink).toHaveBeenCalledWith(
      ORG,
      expect.anything(),
      [{ reference: 'TEE-1', qty: 1 }],
      RUN,
    );
    expect(
      await s.checkoutLink(ORG, { ...base, provider: 'shopify', storeId: 'not-a-uuid' }),
    ).toBeNull();
    expect(
      await s.checkoutLink(ORG, {
        ...base,
        provider: 'woocommerce',
        storeId: '33333333-3333-4333-8333-333333333333',
      }),
    ).toBeNull();
    expect(await s.checkoutLink(ORG, { ...base, provider: 'whatsapp_shop' })).toBeNull();
  });
});
