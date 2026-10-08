import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpShopifyFactory } from '../../../src/infra/providers/ecom/shopify-admin.client';

/** The Shopify checkout calls (TW-ECOM-036) against a stubbed `fetch`: what is sent, and what is read back. */
const SHOP = 'a.myshopify.com';
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function stub(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      seen.push({ url, init });
      return handler(url, init);
    }),
  );
  return seen;
}
const api = () => new HttpShopifyFactory().checkout(SHOP, 'admin-token');
afterEach(() => vi.unstubAllGlobals());

describe('Shopify checkout client', () => {
  it('finds a variant by its exact sku through the Admin GraphQL API', async () => {
    const seen = stub(() =>
      reply({
        data: {
          productVariants: { nodes: [{ id: 'gid://shopify/ProductVariant/123', sku: 'TEE-1' }] },
        },
      }),
    );
    expect(await api().variantIdBySku('TEE-1')).toBe('123');
    expect(seen[0]!.url).toBe(`https://${SHOP}/admin/api/2026-04/graphql.json`);
    expect((seen[0]!.init.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe(
      'admin-token',
    );
    expect(JSON.parse(String(seen[0]!.init.body)).variables.q).toBe('sku:"TEE-1"');
  });

  it('does not take a near match, strips quotes from the search, and answers null on no match or a failure', async () => {
    stub(() =>
      reply({
        data: {
          productVariants: { nodes: [{ id: 'gid://shopify/ProductVariant/9', sku: 'TEE-10' }] },
        },
      }),
    );
    expect(await api().variantIdBySku('TEE-1')).toBeNull();
    const seen = stub(() => reply({ data: { productVariants: { nodes: [] } } }));
    expect(await api().variantIdBySku('A"B')).toBeNull();
    expect(JSON.parse(String(seen[0]!.init.body)).variables.q).toBe('sku:"AB"');
    stub(() => reply({}, 500));
    expect(await api().variantIdBySku('TEE-1')).toBeNull();
    stub(() => Promise.reject(new Error('down')));
    expect(await api().variantIdBySku('TEE-1')).toBeNull();
    expect(await api().variantIdBySku('   ')).toBeNull();
  });

  it('takes the first variant of a numeric product id only', async () => {
    const seen = stub(() => reply({ product: { variants: [{ id: 77 }, { id: 78 }] } }));
    expect(await api().firstVariantId('31')).toBe('77');
    expect(seen[0]!.url).toContain('/products/31.json');
    expect(await api().firstVariantId('31/../x')).toBeNull();
  });

  it('makes a Storefront cart with the note and the Storefront token, never the Admin token', async () => {
    const seen = stub(() =>
      reply({
        data: {
          cartCreate: {
            cart: { id: 'gid://shopify/Cart/1', checkoutUrl: 'https://a.myshopify.com/cart/c/1' },
          },
        },
      }),
    );
    const out = await api().createStorefrontCart(
      'sf',
      [{ variantId: '5', qty: 0 }],
      'threadwise-flow:r1',
    );
    expect(out).toEqual({
      url: 'https://a.myshopify.com/cart/c/1',
      cartId: 'gid://shopify/Cart/1',
    });
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers['X-Shopify-Storefront-Access-Token']).toBe('sf');
    expect(headers['X-Shopify-Access-Token']).toBeUndefined();
    expect(seen[0]!.url).toBe(`https://${SHOP}/api/2026-04/graphql.json`);
    const input = JSON.parse(String(seen[0]!.init.body)).variables.input;
    expect(input).toEqual({
      lines: [{ merchandiseId: 'gid://shopify/ProductVariant/5', quantity: 1 }],
      note: 'threadwise-flow:r1',
    });
  });

  it('sends no note key when there is none, and null when the cart has no url', async () => {
    const seen = stub(() =>
      reply({ data: { cartCreate: { cart: null, userErrors: [{ message: 'x' }] } } }),
    );
    expect(await api().createStorefrontCart('sf', [{ variantId: '5', qty: 1 }], null)).toBeNull();
    expect(JSON.parse(String(seen[0]!.init.body)).variables.input).not.toHaveProperty('note');
    expect(await api().createStorefrontCart('', [{ variantId: '5', qty: 1 }], null)).toBeNull();
  });

  it('makes a draft order tagged and noted, and returns its invoice url', async () => {
    const seen = stub(() =>
      reply({ draft_order: { id: 88, invoice_url: 'https://a.myshopify.com/i/1' } }, 201),
    );
    const out = await api().createDraftOrder([{ variantId: '5', qty: 2 }], 'threadwise-flow:r1');
    expect(out).toEqual({ url: 'https://a.myshopify.com/i/1', draftId: '88' });
    expect(JSON.parse(String(seen[0]!.init.body)).draft_order).toEqual({
      line_items: [{ variant_id: 5, quantity: 2 }],
      tags: 'threadwise-flow',
      note: 'threadwise-flow:r1',
    });
    stub(() => reply({ errors: 'x' }, 422));
    expect(await api().createDraftOrder([{ variantId: '5', qty: 1 }], null)).toBeNull();
  });

  it('never calls an address that is not a myshopify.com host', async () => {
    const seen = stub(() => reply({}));
    const bad = new HttpShopifyFactory().checkout('evil.example.com', 't');
    expect(await bad.variantIdBySku('a')).toBeNull();
    expect(await bad.createDraftOrder([{ variantId: '5', qty: 1 }], null)).toBeNull();
    expect(seen).toHaveLength(0);
  });
});
