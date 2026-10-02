import { describe, expect, it, vi } from 'vitest';
import { MetaGraphCatalogProvider } from '../../../src/infra/providers/catalog-products/meta-graph.catalog.provider';
import { HttpBaileysCatalogBridge } from '../../../src/infra/providers/catalog-products/http-baileys.catalog-bridge';
import {
  CatalogProviderError,
  type CatalogBinding,
} from '../../../src/infra/providers/catalog-products/catalog-provider.port';
import { readCatalogEnv } from '../../../src/config/domains/catalog-products.env';
import { buildMetaItem } from '../../../src/modules/catalog-products/catalog-rules';

const TOKEN = 'EAAG-secret-token-0123456789';
const meta: CatalogBinding = {
  provider: 'meta_cloud',
  catalogId: '555',
  wabaId: 'w1',
  phoneNumberId: '999',
  accessToken: TOKEN,
};
const d360: CatalogBinding = {
  provider: 'dialog_360',
  catalogId: '555',
  wabaId: null,
  phoneNumberId: null,
  accessToken: 'D360KEY-abcdef',
};

interface Call {
  url: string;
  init: RequestInit;
}
function mockFetch(responses: Array<{ status?: number; body?: unknown } | Error>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses.shift() ?? { status: 200, body: {} };
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  });
  return { calls, impl: impl as unknown as typeof fetch };
}
const make = (f: typeof fetch) =>
  new MetaGraphCatalogProvider({ graphVersion: 'v23.0', fetchImpl: f, retryDelayMs: 0 });
const headers = (c: Call) => c.init.headers as Record<string, string>;
const body = (c: Call) => JSON.parse(c.init.body as string);

describe('live adapter: Meta Cloud vs 360dialog (TW-CAT-034)', () => {
  it('verify is a Graph GET with a bearer token for Meta Cloud and the D360 header for 360dialog', async () => {
    const m = mockFetch([
      { body: { id: '555', name: 'Shop', product_count: 3 } },
      { body: { id: '555' } },
    ]);
    const p = make(m.impl);
    expect(await p.verifyCatalog(meta)).toEqual({ id: '555', name: 'Shop', productCount: 3 });
    await p.verifyCatalog(d360);
    expect(m.calls[0]!.url).toBe(
      'https://graph.facebook.com/v23.0/555?fields=id%2Cname%2Cproduct_count%2Cvertical%2Cis_catalog_segment',
    );
    expect(headers(m.calls[0]!).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers(m.calls[1]!)['D360-API-KEY']).toBe('D360KEY-abcdef');
    expect(headers(m.calls[1]!).Authorization).toBeUndefined();
  });

  it('messages go to the phone number id path for Meta Cloud and the 360dialog host for 360dialog', async () => {
    const m = mockFetch([
      { body: { messages: [{ id: 'wamid.1' }] } },
      { body: { messages: [{ id: 'wamid.2' }] } },
    ]);
    const p = make(m.impl);
    expect((await p.sendCatalogLink(meta, '911', 'hi')).messageId).toBe('wamid.1');
    await p.sendCatalogLink(d360, '911', 'hi');
    expect(m.calls[0]!.url).toBe('https://graph.facebook.com/v23.0/999/messages');
    expect(m.calls[1]!.url).toBe('https://waba-v2.360dialog.io/messages');
  });

  it('Meta Cloud without a phone number id cannot send', async () => {
    const p = make(mockFetch([]).impl);
    await expect(p.sendText({ ...meta, phoneNumberId: null }, '911', 'x')).rejects.toMatchObject({
      kind: 'config',
    });
  });
});

describe('live adapter: payload shapes', () => {
  it('items_batch is one CREATE per product keyed on the retailer id, with the converted price', async () => {
    const m = mockFetch([{ body: { handles: ['h1', 'h2'] } }]);
    const item = buildMetaItem(
      {
        id: 1,
        sku: 'IDR-1',
        metaRetailerId: null,
        availability: 'in stock',
        status: 'active',
        stockQty: 4,
        name: 'Batik',
        slug: 'batik',
        description: null,
        condition: 'new',
        priceMinor: 39_500_000,
        currencyCode: 'IDR',
        imageUrl: null,
        galleryUrls: [],
        productUrl: null,
        brand: null,
        category: null,
        googleProductCategory: null,
      },
      '',
    );
    const handles = await make(m.impl).upsertProductsBatch(meta, [
      { retailerId: 'IDR-1', data: item },
      { retailerId: 'b', data: { retailer_id: 'b' } },
    ]);
    expect(handles).toEqual(['h1', 'h2']);
    expect(m.calls[0]!.url).toBe('https://graph.facebook.com/v23.0/555/items_batch');
    const sent = body(m.calls[0]!);
    expect(sent.item_type).toBe('PRODUCT_ITEM');
    expect(sent.requests[0]).toMatchObject({
      method: 'CREATE',
      retailer_id: 'IDR-1',
      data: { price: 395_000, currency: 'IDR', inventory: 4 },
    });
    expect(sent.requests).toHaveLength(2);
  });

  it('an empty batch calls nothing', async () => {
    const m = mockFetch([]);
    expect(await make(m.impl).upsertProductsBatch(meta, [])).toEqual([]);
    expect(m.calls).toHaveLength(0);
  });

  it('batch status asks with the handles as a JSON array and reads status and first error', async () => {
    const m = mockFetch([
      {
        body: {
          data: [
            { handle: 'h1', status: 'finished' },
            { handle: 'h2', status: 'error', errors: [{ message: 'bad price' }] },
          ],
        },
      },
    ]);
    const rows = await make(m.impl).checkBatchStatus(meta, ['h1', 'h2']);
    expect(decodeURIComponent(m.calls[0]!.url)).toContain(
      'check_batch_request_status?handles=["h1","h2"]',
    );
    expect(rows).toEqual([
      { handle: 'h1', status: 'finished', errors: [] },
      { handle: 'h2', status: 'error', errors: [{ message: 'bad price' }] },
    ]);
  });

  it('commerce settings post both flags to the phone number', async () => {
    const m = mockFetch([{ body: { success: true } }]);
    await make(m.impl).setCommerceSettings(meta, { catalogVisible: true, cartEnabled: false });
    expect(m.calls[0]!.url).toBe('https://graph.facebook.com/v23.0/999/whatsapp_commerce_settings');
    expect(body(m.calls[0]!)).toEqual({ is_cart_enabled: false, is_catalog_visible: true });
    await expect(
      make(mockFetch([]).impl).setCommerceSettings(
        { ...meta, phoneNumberId: null },
        { catalogVisible: true, cartEnabled: true },
      ),
    ).rejects.toMatchObject({ kind: 'config' });
  });

  it('SPM is an interactive product message; the body is cut at 1024 and the footer at 60', async () => {
    const m = mockFetch([{ body: {} }]);
    await make(m.impl).sendSPM(meta, '911', 'R1', 'b'.repeat(2000), 'f'.repeat(100));
    const sent = body(m.calls[0]!);
    expect(sent).toMatchObject({ messaging_product: 'whatsapp', to: '911', type: 'interactive' });
    expect(sent.interactive.type).toBe('product');
    expect(sent.interactive.body.text).toHaveLength(1024);
    expect(sent.interactive.footer.text).toHaveLength(60);
    expect(sent.interactive.action).toEqual({ catalog_id: '555', product_retailer_id: 'R1' });
  });

  it('MPM keeps 30 products over at most 10 sections with titles cut at 24', async () => {
    const m = mockFetch([{ body: {} }]);
    const sections = Array.from({ length: 12 }, (_, i) => ({
      title: `Section number ${i} with a long title`,
      productRetailerIds: ['a', 'b', 'c', 'd'],
    }));
    await make(m.impl).sendMPM(meta, '911', 'H'.repeat(90), 'body', sections, null);
    const sent = body(m.calls[0]!);
    expect(sent.interactive.type).toBe('product_list');
    expect(sent.interactive.header.text).toHaveLength(60);
    expect(sent.interactive.action.sections).toHaveLength(8); // 30 products / 4 per section = 7 full + 2
    const items = sent.interactive.action.sections.flatMap(
      (s: { product_items: unknown[] }) => s.product_items,
    );
    expect(items).toHaveLength(30);
    expect(sent.interactive.action.sections[0].title).toHaveLength(24);
    expect(sent.interactive).not.toHaveProperty('footer');
  });

  it('the catalog link is a text message with a link preview', async () => {
    const m = mockFetch([{ body: {} }]);
    await make(m.impl).sendCatalogLink(meta, '911', 'see https://wa.me/c/1');
    expect(body(m.calls[0]!)).toMatchObject({
      type: 'text',
      text: { body: 'see https://wa.me/c/1', preview_url: true },
    });
  });

  it('listing follows the paging cursor and stops at max', async () => {
    const page = (n: number, next: boolean) => ({
      body: {
        data: Array.from({ length: n }, (_, i) => ({
          id: `${i}`,
          retailer_id: `r${i}`,
          name: 'n',
          price: 'USD 1',
        })),
        paging: next ? { cursors: { after: 'c2' }, next: 'x' } : {},
      },
    });
    const m = mockFetch([page(2, true), page(2, false)]);
    const rows = await make(m.impl).listProducts(meta);
    expect(rows).toHaveLength(4);
    expect(m.calls[1]!.url).toContain('after=c2');
    const m2 = mockFetch([page(5, true)]);
    expect(await make(m2.impl).listProducts(meta, 3)).toHaveLength(3);
  });

  it('autodetect calls: list, create with the commerce vertical, link, name', async () => {
    const m = mockFetch([
      { body: { data: [] } },
      { body: { id: 'new1' } },
      { body: { success: true } },
      { body: { name: 'Shop' } },
    ]);
    const p = make(m.impl);
    const auth = { accessToken: TOKEN };
    expect(await p.listWabaCatalogs(auth, 'w1')).toEqual([]);
    expect(await p.createCatalog(auth, 'biz', 'Brand · 2026-10-02')).toBe('new1');
    await p.linkCatalogToWaba(auth, 'w1', 'new1');
    expect(await p.catalogName(auth, 'new1')).toBe('Shop');
    expect(m.calls[0]!.url).toBe('https://graph.facebook.com/v23.0/w1/product_catalogs');
    expect(body(m.calls[1]!)).toEqual({ name: 'Brand · 2026-10-02', vertical: 'commerce' });
    expect(m.calls[1]!.url).toContain('/biz/owned_product_catalogs');
    expect(body(m.calls[2]!)).toEqual({ catalog_id: 'new1' });
  });
});

describe('live adapter: error mapping and retries', () => {
  it("Meta's error envelope becomes a typed error with message, code and subcode", async () => {
    const m = mockFetch([
      {
        status: 400,
        body: {
          error: { message: '(#100) Unsupported get request.', code: 100, error_subcode: 33 },
        },
      },
    ]);
    const err = await make(m.impl)
      .verifyCatalog(meta)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CatalogProviderError);
    expect(err).toMatchObject({
      kind: 'meta',
      message: '(#100) Unsupported get request.',
      meta: { code: 100, subcode: 33, httpStatus: 400, raw: '(#100) Unsupported get request.' },
    });
  });
  it('a failure without an envelope reads "HTTP <status>: <operation>"', async () => {
    const m = mockFetch([{ status: 404, body: {} }]);
    await expect(make(m.impl).verifyCatalog(meta)).rejects.toMatchObject({
      message: 'HTTP 404: verifyCatalog',
      meta: { code: 404 },
    });
  });
  it('the access token never appears in an error', async () => {
    const m = mockFetch([
      { status: 400, body: { error: { message: `Invalid token ${TOKEN}`, code: 190 } } },
    ]);
    const err = (await make(m.impl)
      .verifyCatalog(meta)
      .catch((e: unknown) => e)) as CatalogProviderError;
    expect(err.message).not.toContain(TOKEN);
    expect(err.meta.raw).not.toContain(TOKEN);
    const net = mockFetch([
      new Error(`connect failed for ${TOKEN}`),
      new Error(`connect failed for ${TOKEN}`),
    ]);
    const err2 = (await make(net.impl)
      .verifyCatalog(meta)
      .catch((e: unknown) => e)) as CatalogProviderError;
    expect(err2.kind).toBe('network');
    expect(err2.message).not.toContain(TOKEN);
  });
  it('a safe call is retried once after a network error or a 5xx', async () => {
    const m = mockFetch([new Error('reset'), { body: { id: '555' } }]);
    expect((await make(m.impl).verifyCatalog(meta)).id).toBe('555');
    expect(m.calls).toHaveLength(2);
    const m2 = mockFetch([{ status: 503, body: {} }, { body: { id: '555' } }]);
    await make(m2.impl).verifyCatalog(meta);
    expect(m2.calls).toHaveLength(2);
  });
  it('a 4xx is not retried and a message send is never retried', async () => {
    const m = mockFetch([{ status: 400, body: { error: { message: 'x', code: 1 } } }]);
    await make(m.impl)
      .verifyCatalog(meta)
      .catch(() => undefined);
    expect(m.calls).toHaveLength(1);
    const s = mockFetch([new Error('reset'), { body: { messages: [{ id: 'dup' }] } }]);
    await expect(make(s.impl).sendText(meta, '911', 'x')).rejects.toMatchObject({
      kind: 'network',
    });
    expect(s.calls).toHaveLength(1);
  });
});

describe('Node bridge adapter (unverified against a live bridge)', () => {
  it('posts the carousel to /api/send-product-catalog/<sender> with the Reference payload', async () => {
    const m = mockFetch([{ body: { success: true, messageId: 'bw1' } }]);
    const bridge = new HttpBaileysCatalogBridge({
      target: { baseUrl: 'http://node:8888/', token: 't' },
      fetchImpl: m.impl,
    });
    const card = {
      retailer_id: 'r',
      id: 'u',
      name: 'n',
      description: null,
      image_url: null,
      price: 12.5,
      currency: 'USD',
      category: null,
      availability: 'in stock',
      url: null,
    };
    const out = await bridge.sendCarousel({
      senderPhone: '911',
      to: '922',
      cards: [card],
      headerText: 'H',
      bodyText: 'B',
      footerText: '',
    });
    expect(out.messageId).toBe('bw1');
    expect(m.calls[0]!.url).toBe('http://node:8888/api/send-product-catalog/911');
    expect(headers(m.calls[0]!)['X-Node-Token']).toBe('t');
    expect(body(m.calls[0]!).json).toMatchObject({
      targetPhoneNumber: '922',
      type: 'single',
      header_text: 'H',
      body_text: 'B',
      section_title: 'Products',
    });
  });
  it('two cards are type multi; no cards is refused; text and image use their endpoints', async () => {
    const m = mockFetch([
      { body: { success: true } },
      { body: { success: true } },
      { body: { success: true } },
    ]);
    const bridge = new HttpBaileysCatalogBridge({
      target: { baseUrl: 'http://node' },
      fetchImpl: m.impl,
    });
    const c = {
      retailer_id: 'r',
      id: 'u',
      name: 'n',
      description: null,
      image_url: null,
      price: 1,
      currency: 'USD',
      category: null,
      availability: 'in stock',
      url: null,
    };
    await bridge.sendCarousel({
      senderPhone: '1',
      to: '2',
      cards: [c, c],
      headerText: '',
      bodyText: '',
      footerText: '',
    });
    expect(body(m.calls[0]!).json.type).toBe('multi');
    await expect(
      bridge.sendCarousel({
        senderPhone: '1',
        to: '2',
        cards: [],
        headerText: '',
        bodyText: '',
        footerText: '',
      }),
    ).rejects.toBeInstanceOf(CatalogProviderError);
    await bridge.sendText({ senderPhone: '1', to: '2', text: 'hello' });
    await bridge.sendImage({
      senderPhone: '1',
      to: '2',
      imageUrl: 'https://i/x.jpg',
      caption: 'cap',
    });
    expect(m.calls[1]!.url).toBe('http://node/api/send-message/1');
    expect(body(m.calls[1]!)).toEqual({ targetPhoneNumber: '2', message: 'hello' });
    expect(m.calls[2]!.url).toBe('http://node/api/send-media-message/1');
    expect(body(m.calls[2]!).json).toMatchObject({ file: 'https://i/x.jpg', caption: 'cap' });
  });
  it('a bridge failure carries its error text', async () => {
    const m = mockFetch([{ status: 500, body: { error: 'session closed' } }]);
    const bridge = new HttpBaileysCatalogBridge({
      target: { baseUrl: 'http://node' },
      fetchImpl: m.impl,
    });
    await expect(bridge.sendText({ senderPhone: '1', to: '2', text: 'x' })).rejects.toMatchObject({
      message: 'Baileys link send failed: session closed',
    });
  });
});

describe('catalog configuration (TW-CAT-030)', () => {
  it('defaults: live mode, Graph v23.0, the local bridge, hourly resync', () => {
    expect(readCatalogEnv({})).toMatchObject({
      CAT_PROVIDER_MODE: 'live',
      CAT_GRAPH_API_VERSION: 'v23.0',
      BAILEYS_SERVER_URL: 'http://localhost:8888',
      CAT_RESYNC_INTERVAL_MS: 3_600_000,
    });
  });
  it('reads the overrides, SERVER_URL as the bridge fallback, and refuses a bad version', () => {
    expect(
      readCatalogEnv({
        CAT_PROVIDER_MODE: 'fixture',
        CAT_GRAPH_API_VERSION: 'v24.0',
        SERVER_URL: 'http://n:1',
      }),
    ).toMatchObject({
      CAT_PROVIDER_MODE: 'fixture',
      CAT_GRAPH_API_VERSION: 'v24.0',
      BAILEYS_SERVER_URL: 'http://n:1',
    });
    expect(() => readCatalogEnv({ CAT_GRAPH_API_VERSION: '23' })).toThrow(/Graph API version/);
  });
});

describe('runtime settings are read on every call (TW-CAT-030, 034)', () => {
  it('a Graph version function is asked per call, so a saved change applies to the next request', async () => {
    const m = mockFetch([{ body: { id: '1' } }, { body: { id: '1' } }]);
    let version = 'v23.0';
    const p = new MetaGraphCatalogProvider({
      graphVersion: async () => version,
      fetchImpl: m.impl,
      retryDelayMs: 0,
    });
    const binding = {
      provider: 'meta_cloud' as const,
      catalogId: '555',
      wabaId: null,
      phoneNumberId: '100',
      accessToken: 'tok',
    };
    await p.verifyCatalog(binding);
    version = 'v24.0';
    await p.verifyCatalog(binding);
    expect(m.calls[0]!.url).toContain('/v23.0/555');
    expect(m.calls[1]!.url).toContain('/v24.0/555');
  });

  it('the bridge target function is asked per call: address and token follow the operator page', async () => {
    const m = mockFetch([
      { body: { success: true, messageId: 'a' } },
      { body: { success: true, messageId: 'b' } },
    ]);
    let target = { baseUrl: 'http://one:8888', token: 't1' as string | null };
    const bridge = new HttpBaileysCatalogBridge({ target: () => target, fetchImpl: m.impl });
    await bridge.sendText({ senderPhone: '1', to: '2', text: 'x' });
    target = { baseUrl: 'http://two:9999/', token: null };
    await bridge.sendText({ senderPhone: '1', to: '2', text: 'x' });
    expect(m.calls[0]!.url).toBe('http://one:8888/api/send-message/1');
    expect(headers(m.calls[0]!)['X-Node-Token']).toBe('t1');
    expect(m.calls[1]!.url).toBe('http://two:9999/api/send-message/1');
    expect(headers(m.calls[1]!)['X-Node-Token']).toBeUndefined();
  });
});
