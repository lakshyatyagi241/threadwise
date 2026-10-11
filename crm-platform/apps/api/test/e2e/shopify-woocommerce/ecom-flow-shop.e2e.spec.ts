import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  SHOPIFY,
  WOOCOMMERCE,
  type CheckoutLine,
  type ShopifyFactory,
  type WooFactory,
} from '../../../src/infra/providers/ecom/ecom.port';
import {
  WebhookPipelineService,
  type WebhookJob,
} from '../../../src/modules/shopify-woocommerce/webhook-pipeline.service';
import { simInbound } from '../chat-conversations/pipeline-support';
import {
  addFlow,
  edge,
  graph,
  node,
  simChannel,
  startFlowPipeline,
  runsOf,
  until,
  untilRun,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from '../flow-runtime-engine/support';

/**
 * The flow's shop node with Shopify and WooCommerce (TW-ECOM-036, 037, TW-FLR-041) against a real Postgres, Redis and BullMQ, with
 * the stores' own APIs faked: the customer picks a product, is sent a checkout link that carries the run's reference, and the
 * store's order webhook (the real pipeline) resumes the same run through `purchased`.
 */
let p: FlowPipeline;
let pipeline: WebhookPipelineService;
let crypto: CryptoService;
let t: Tenant;
let ch: SimChannel;

const carts: Array<{ token: string; lines: readonly CheckoutLine[]; note: string | null }> = [];
const drafts: Array<{ lines: readonly CheckoutLine[]; note: string | null }> = [];
const wooOrders: Array<{ items: unknown; flow: string | null }> = [];
const skusAsked: string[] = [];
let wooAnswers = true;

beforeAll(async () => {
  p = await startFlowPipeline();
  pipeline = p.h.app.get(WebhookPipelineService);
  crypto = p.h.app.get(CryptoService, { strict: false });
  const shopify = p.h.app.get<ShopifyFactory>(SHOPIFY);
  shopify.checkout = () => ({
    variantIdBySku: (sku) => {
      skusAsked.push(sku);
      return Promise.resolve(sku === 'GONE' ? null : '555');
    },
    firstVariantId: () => Promise.resolve('556'),
    createStorefrontCart: (token, lines, note) => {
      carts.push({ token, lines, note });
      return Promise.resolve({ url: 'https://shop.test/cart/c/abc', cartId: 'gid://cart/1' });
    },
    createDraftOrder: (lines, note) => {
      drafts.push({ lines, note });
      return Promise.resolve({ url: 'https://shop.test/invoices/77', draftId: '77' });
    },
  });
  const woo = p.h.app.get<WooFactory>(WOOCOMMERCE);
  woo.store = () =>
    ({
      createPendingOrder: (items: unknown, flow: string | null) => {
        wooOrders.push({ items, flow });
        return Promise.resolve(wooAnswers ? { url: 'https://woo.test/pay/9', orderId: '9' } : null);
      },
    }) as never;
  t = await p.api.signup('ecomshop');
  ch = await simChannel(p as never, t);
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

beforeEach(() => {
  carts.length = 0;
  drafts.length = 0;
  wooOrders.length = 0;
  skusAsked.length = 0;
  wooAnswers = true;
});

let counter = 0;
const nextPeer = () => `9197${String(30000000 + counter++).padStart(8, '0')}`;
const secret = () => randomBytes(10).toString('hex');

async function shopifyStore(metadata: Record<string, unknown> = {}) {
  const r = await p.h.owner.query(
    `INSERT INTO shopify_integrations (org_id, user_id, store_url, store_name, shop_currency, access_token, webhook_secret, metadata)
     VALUES ($1, $2, $3, 'S', 'USD', $4, $5, $6::jsonb) RETURNING id, uuid`,
    [
      t.orgId,
      t.adminUserId,
      `${secret()}.myshopify.com`,
      crypto.encrypt('admin-token'),
      secret(),
      JSON.stringify(metadata),
    ],
  );
  return { id: Number(r.rows[0].id), uuid: String(r.rows[0].uuid) };
}

async function wooStore() {
  const r = await p.h.owner.query(
    `INSERT INTO woocommerce_integrations (org_id, user_id, store_url, store_name, store_currency, consumer_key, consumer_secret, webhook_secret)
     VALUES ($1, $2, $3, 'W', 'USD', $4, $5, $6) RETURNING id, uuid`,
    [
      t.orgId,
      t.adminUserId,
      `https://${secret()}.test`,
      crypto.encrypt('ck'),
      crypto.encrypt('cs'),
      secret(),
    ],
  );
  return { id: Number(r.rows[0].id), uuid: String(r.rows[0].uuid) };
}

async function mirrored(
  kind: 'shopify' | 'woocommerce',
  sku: string | null,
  name: string,
  over: { inStock?: boolean; storeProductId?: string } = {},
) {
  const col = kind === 'shopify' ? 'shopify_product_id' : 'woo_product_id';
  const r = await p.h.owner.query(
    `INSERT INTO wa_products (org_id, ${col}, sku, name, slug, price_minor, currency_code, in_stock, availability)
     VALUES ($1, $2, $3, $4, $5, 1500, 'USD', $6, $7) RETURNING id`,
    [
      t.orgId,
      over.storeProductId ?? String(Math.floor(Math.random() * 1e9)),
      sku,
      name,
      `${name}-${secret()}`,
      over.inStock ?? true,
      over.inStock === false ? 'out of stock' : 'in stock',
    ],
  );
  return Number(r.rows[0].id);
}

const shopFlow = (
  kind: 'shopify' | 'woocommerce',
  storeUuid: string,
  keyword: string,
  products: Array<{ retailer_id: string; name: string }>,
) =>
  addFlow(p, t, {
    graph: graph(
      [
        node('s', kind, {
          storeId: storeUuid,
          bodyText: 'Pick one',
          productItems: products.map((x) => ({ ...x, price_minor: 1500, currency: 'USD' })),
        }),
        node('bought', 'message', {
          text: 'Thanks! order {{order_id}} = {{order_total}} {{order_currency}}',
        }),
        node('gone', 'message', { text: 'Maybe later' }),
      ],
      [edge('s', 'bought', 'purchased'), edge('s', 'gone', 'abandoned')],
    ),
    trigger: { kind: 'keyword', keywords: keyword },
  });

/** A customer starts the flow and picks the first product; returns the waiting run once the link is out. */
async function pickFirst(flowId: number, keyword: string, expectedCards: number) {
  const peer = nextPeer();
  await simInbound(p, t, ch, { from: peer, name: 'Asha', text: keyword });
  // a lead-in, one card per product, the prompt
  const offered = await untilSent(p, t, ch, peer, expectedCards + 2);
  await simInbound(p, t, ch, { from: peer, name: 'Asha', text: '1' });
  const sent = await untilSent(p, t, ch, peer, expectedCards + 3);
  const run = await untilRun(p, t, flowId, 'waiting for the order', (r) => r.status === 'waiting');
  return { peer, offered, link: sent[expectedCards + 2]!, run };
}

const job = (
  kind: 'shopify' | 'woocommerce',
  storeId: number,
  eventType: string,
  data: Record<string, unknown>,
  orgId = t.orgId,
): WebhookJob => ({
  orgId,
  kind,
  storeId,
  eventType,
  data,
  log: { id: 0, createdAt: new Date().toISOString() },
});

const shopifyOrder = (note: string | null, over: Record<string, unknown> = {}) => ({
  id: 9001,
  name: '#1001',
  total_price: '25.00',
  currency: 'USD',
  note,
  line_items: [],
  ...over,
});

const wooOrder = (flowRef: string | null, over: Record<string, unknown> = {}) => ({
  id: 7001,
  number: '7001',
  total: '30.00',
  currency: 'USD',
  status: 'processing',
  meta_data: flowRef ? [{ key: '_wa_flow_session', value: flowRef }] : [],
  line_items: [],
  ...over,
});

describe('Shopify: cart link, then the order resumes the run (TW-ECOM-036, 037)', () => {
  it.each(['orders/create', 'orders/paid'])(
    'a store with a Storefront token sends a cart tagged with the run; %s takes the purchased port',
    async (topic) => {
      const store = await shopifyStore({ storefrontAccessToken: 'sf-token' });
      await mirrored('shopify', 'TEE-1', 'Tee');
      const keyword = `cart${secret()}`;
      const f = await shopFlow('shopify', store.uuid, keyword, [
        { retailer_id: 'TEE-1', name: 'Tee' },
      ]);
      const { peer, offered, link, run } = await pickFirst(f.id, keyword, 1);

      expect(offered[1]).toContain('Tee');
      expect(link).toContain('https://shop.test/cart/c/abc');
      expect(carts).toEqual([
        {
          token: 'sf-token',
          lines: [{ variantId: '555', qty: 1 }],
          note: `threadwise-flow:${run.uuid}`,
        },
      ]);
      expect(drafts).toEqual([]);

      await pipeline.run(
        job('shopify', store.id, topic, shopifyOrder(`threadwise-flow:${run.uuid}`)),
      );
      const done = await untilRun(p, t, f.id, 'purchased', (r) => r.status === 'completed');
      expect(done.vars).toMatchObject({
        order_id: '9001',
        order_total: '25.00',
        order_currency: 'USD',
        commerce_choice: 'TEE-1',
      });
      expect(await untilSent(p, t, ch, peer, 5)).toContain('Thanks! order 9001 = 25.00 USD');
    },
  );

  it('a store with no Storefront token sends a draft order with the same note', async () => {
    const store = await shopifyStore();
    await mirrored('shopify', 'MUG-1', 'Mug');
    const keyword = `draft${secret()}`;
    const f = await shopFlow('shopify', store.uuid, keyword, [
      { retailer_id: 'MUG-1', name: 'Mug' },
    ]);
    const { link, run } = await pickFirst(f.id, keyword, 1);
    expect(link).toContain('https://shop.test/invoices/77');
    expect(carts).toEqual([]);
    expect(drafts).toEqual([
      { lines: [{ variantId: '555', qty: 1 }], note: `threadwise-flow:${run.uuid}` },
    ]);
  });

  it('a product the store cannot find gives the apology and the run keeps waiting', async () => {
    const store = await shopifyStore();
    const keyword = `gone${secret()}`;
    const f = await shopFlow('shopify', store.uuid, keyword, [
      { retailer_id: 'GONE', name: 'Ghost' },
    ]);
    const peer = nextPeer();
    await simInbound(p, t, ch, { from: peer, name: 'Asha', text: keyword });
    await untilSent(p, t, ch, peer, 3);
    await simInbound(p, t, ch, { from: peer, name: 'Asha', text: 'ghost' });
    const sent = await untilSent(p, t, ch, peer, 4);
    expect(sent[3]).toContain("couldn't generate a checkout link");
    expect(skusAsked).toContain('GONE');
    expect(drafts).toEqual([]);
    const [run] = await runsOf(p, t, f.id);
    expect(run!.status).toBe('waiting');
  });

  it('a sold-out product is not offered (the mirror says so); an unknown one is', async () => {
    const store = await shopifyStore();
    await mirrored('shopify', 'IN-1', 'Inn');
    await mirrored('shopify', 'OUT-1', 'Outt', { inStock: false });
    const keyword = `stock${secret()}`;
    await shopFlow('shopify', store.uuid, keyword, [
      { retailer_id: 'IN-1', name: 'Inn' },
      { retailer_id: 'OUT-1', name: 'Outt' },
      { retailer_id: 'NEW-1', name: 'Neww' },
    ]);
    const peer = nextPeer();
    await simInbound(p, t, ch, { from: peer, name: 'Asha', text: keyword });
    const sent = await untilSent(p, t, ch, peer, 4);
    const all = sent.join('\n');
    expect(all).toContain('Inn');
    expect(all).toContain('Neww');
    expect(all).not.toContain('Outt');
  });
});

describe('WooCommerce: order link, then the order resumes the run (TW-ECOM-036, 037)', () => {
  it.each(['order.created', 'order.updated'])(
    'a pending order tagged with the run is sent; %s takes the purchased port',
    async (topic) => {
      const store = await wooStore();
      await mirrored('woocommerce', null, 'Hat', { storeProductId: '31' });
      const hatId = await p.h.owner
        .query(`SELECT id FROM wa_products WHERE org_id = $1 AND woo_product_id = '31'`, [t.orgId])
        .then((r) => Number(r.rows[0].id));
      const keyword = `woo${secret()}`;
      const f = await shopFlow('woocommerce', store.uuid, keyword, [
        { retailer_id: `wsn-${hatId}`, name: 'Hat' },
      ]);
      const { peer, link, run } = await pickFirst(f.id, keyword, 1);
      expect(link).toContain('https://woo.test/pay/9');
      // a product with no sku is named to the store by its WooCommerce id
      expect(wooOrders).toEqual([{ items: [{ reference: '31', qty: 1 }], flow: run.uuid }]);

      await pipeline.run(job('woocommerce', store.id, topic, wooOrder(run.uuid)));
      const done = await untilRun(p, t, f.id, 'purchased', (r) => r.status === 'completed');
      expect(done.vars).toMatchObject({ order_id: '7001', order_total: '30.00' });
      expect(await untilSent(p, t, ch, peer, 5)).toContain('Thanks! order 7001 = 30.00 USD');
    },
  );

  it('an order that names the run only in the customer note also resumes it', async () => {
    const store = await wooStore();
    const keyword = `note${secret()}`;
    const f = await shopFlow('woocommerce', store.uuid, keyword, [
      { retailer_id: 'SH-1', name: 'Shirt' },
    ]);
    const { run } = await pickFirst(f.id, keyword, 1);
    await pipeline.run(
      job(
        'woocommerce',
        store.id,
        'order.created',
        wooOrder(null, { customer_note: `please ship fast threadwise-flow:${run.uuid}.` }),
      ),
    );
    await untilRun(p, t, f.id, 'purchased', (r) => r.status === 'completed');
  });

  it('a store that does not answer gives the apology, and the customer may try again', async () => {
    const store = await wooStore();
    wooAnswers = false;
    const keyword = `down${secret()}`;
    const f = await shopFlow('woocommerce', store.uuid, keyword, [
      { retailer_id: 'SH-2', name: 'Shirt' },
    ]);
    const peer = nextPeer();
    await simInbound(p, t, ch, { from: peer, name: 'Asha', text: keyword });
    await untilSent(p, t, ch, peer, 3);
    await simInbound(p, t, ch, { from: peer, name: 'Asha', text: '1' });
    expect((await untilSent(p, t, ch, peer, 4))[3]).toContain("couldn't generate a checkout link");
    wooAnswers = true;
    await simInbound(p, t, ch, { from: peer, name: 'Asha', text: '1' });
    expect((await untilSent(p, t, ch, peer, 5))[4]).toContain('https://woo.test/pay/9');
    const [run] = await runsOf(p, t, f.id);
    expect(run!.status).toBe('waiting');
  });
});

describe('what must not resume a run (TW-ECOM-037)', () => {
  it('ignores an order with no reference, a reference that is not a run, a topic that is not an order event, and another workspace', async () => {
    const store = await shopifyStore();
    const keyword = `neg${secret()}`;
    const f = await shopFlow('shopify', store.uuid, keyword, [
      { retailer_id: 'TEE-9', name: 'Tee' },
    ]);
    const { run } = await pickFirst(f.id, keyword, 1);
    const note = `threadwise-flow:${run.uuid}`;

    await pipeline.run(job('shopify', store.id, 'orders/create', shopifyOrder(null)));
    await pipeline.run(
      job('shopify', store.id, 'orders/create', shopifyOrder('threadwise-flow:not-a-run')),
    );
    await pipeline.run(
      job('shopify', store.id, 'orders/create', shopifyOrder("threadwise-flow:1' OR '1'='1")),
    );
    await pipeline.run(job('shopify', store.id, 'orders/updated', shopifyOrder(note)));
    await pipeline.run(job('shopify', store.id, 'orders/cancelled', shopifyOrder(note)));

    // The same reference arriving as another workspace's order is nobody's run there.
    const other = await p.api.signup('ecomshopb');
    await pipeline.run(job('shopify', store.id, 'orders/create', shopifyOrder(note), other.orgId));

    const [still] = await runsOf(p, t, f.id);
    expect(still!.status).toBe('waiting');

    // The real order still works afterwards, and a second event for the finished run is harmless.
    await pipeline.run(job('shopify', store.id, 'orders/create', shopifyOrder(note)));
    await untilRun(p, t, f.id, 'purchased', (r) => r.status === 'completed');
    await pipeline.run(job('shopify', store.id, 'orders/paid', shopifyOrder(note)));
    await until('the run stays completed', async () =>
      (await runsOf(p, t, f.id))[0]!.status === 'completed' ? true : undefined,
    );
  });
});
