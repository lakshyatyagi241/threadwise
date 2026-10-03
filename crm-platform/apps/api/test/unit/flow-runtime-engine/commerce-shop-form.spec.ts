import { describe, expect, it } from 'vitest';
import { flowRefOf } from '../../../src/modules/shopify-woocommerce/order-hooks';
import type { ShopProduct } from '../../../src/modules/flow-runtime-engine/graph/commerce-shapes';
import { FormNode } from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/form-node';
import { ShopNode } from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/shop-node';
import {
  FlowShopGate,
  flowTag,
  type FlowShopPort,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/shop-port';
import {
  pickIndex,
  pickPrompt,
  preamble,
  productCaption,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/shop-rules';
import {
  flattenAnswer,
  formToken,
  parseFormToken,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/wa-form-records';
import type {
  InboundReply,
  NodeContext,
  OutboundMessage,
  WaitSpec,
} from '../../../src/modules/flow-runtime-engine/runtime/types';

const prod = (id: string, name: string, over: Partial<ShopProduct> = {}): ShopProduct => ({
  retailerId: id,
  name,
  image: '',
  priceMinor: 0,
  currency: '',
  url: '',
  ...over,
});
const P = [
  prod('a', 'Red Shirt', { priceMinor: 49900, currency: 'INR', image: 'https://x/a.png' }),
  prod('b', 'Blue Jeans'),
];

describe('shop rules (WD-FLR-041)', () => {
  it('writes a card with name, price when it has one, and how to pick it', () => {
    expect(productCaption(1, P[0]!)).toBe(
      "*1. Red Shirt*\nINR 499.00\n_Reply '1' to buy this one._",
    );
    expect(productCaption(2, P[1]!)).toBe("*2. Blue Jeans*\n_Reply '2' to buy this one._");
    expect(productCaption(3, prod('sku9', ''))).toContain('*3. sku9*');
  });

  it('asks with every name again and the footer in italics', () => {
    expect(pickPrompt(P, 'Free delivery')).toBe(
      'Reply with the number of the product you want to buy:\n  1. Red Shirt\n  2. Blue Jeans\n_Free delivery_',
    );
    expect(preamble('Sale', 'Tap one')).toBe('*Sale*\n\nTap one');
    expect(preamble('', '')).toBe('');
  });

  it('picks by number, then by part of the name', () => {
    expect(pickIndex('2', P)).toBe(1);
    expect(pickIndex('2 please', P)).toBe(1);
    expect(pickIndex('jeans', P)).toBe(1);
    expect(pickIndex('9', P)).toBe(-1);
    expect(pickIndex('hat', P)).toBe(-1);
    expect(pickIndex('', P)).toBe(-1);
  });
});

describe('the order tag a store order carries', () => {
  it('reads Shopify notes and WooCommerce meta or customer notes, and nothing else', () => {
    expect(flowRefOf('shopify', { note: `please wrap. ${flowTag('abc-123')}.` })).toBe('abc-123');
    expect(flowRefOf('shopify', { note: 'no tag' })).toBeNull();
    expect(
      flowRefOf('woocommerce', { meta_data: [{ key: '_wa_flow_session', value: 'run-1' }] }),
    ).toBe('run-1');
    expect(flowRefOf('woocommerce', { customer_note: 'hi wadesk-flow:run-2)' })).toBe('run-2');
    expect(flowRefOf('woocommerce', {})).toBeNull();
  });
});

// --- the shop node against a fake store port ---------------------------------------------------------------------------------

function ctxOf(
  props: Record<string, unknown>,
  sent: OutboundMessage[],
  wait: WaitSpec | null = null,
  run: Record<string, unknown> = {},
): NodeContext {
  return {
    run: {
      orgId: 1,
      uuid: 'run-uuid',
      peerKey: '919800000001',
      channelKind: 'whatsapp_qr',
      wait,
      ...run,
    },
    stepKey: 'k',
    node: { id: 'n', type: 'CommerceShop', props },
    send: async (m: OutboundMessage) => {
      sent.push(m);
      return { ok: true };
    },
    render: (t: unknown) => String(t ?? ''),
    note: () => undefined,
    now: () => new Date(),
  } as unknown as NodeContext;
}

const gateWith = (impl: Partial<FlowShopPort>): FlowShopGate => {
  const g = new FlowShopGate();
  g.use({
    inStock: async () => null,
    sendNative: async () => false,
    checkoutLink: async () => null,
    ...impl,
  });
  return g;
};

const shopProps = (over: Record<string, unknown> = {}) => ({
  provider: 'woocommerce',
  storeId: '7',
  headerText: 'Sale',
  bodyText: 'Tap one',
  footerText: '',
  abandonedWaitMinutes: 3,
  products: P,
  ...over,
});

describe('the Commerce shop node', () => {
  it('sends a lead-in, a card per product and the prompt, then waits with the abandon time and port', async () => {
    const sent: OutboundMessage[] = [];
    const r = await new ShopNode(gateWith({})).execute(ctxOf(shopProps(), sent));
    expect(sent.map((m) => m.kind)).toEqual(['text', 'media', 'text', 'text']);
    expect(sent[1]).toMatchObject({ kind: 'media', mediaKind: 'image', url: 'https://x/a.png' });
    expect(r).toMatchObject({
      kind: 'wait',
      wait: {
        kind: 'Custom',
        handler: 'CommerceShop',
        timeoutSeconds: 180,
        timeoutPort: 2,
        variable: 'commerce_choice',
      },
    });
  });

  it('takes abandoned with nothing to sell, and when everything is out of stock', async () => {
    const sent: OutboundMessage[] = [];
    expect(
      await new ShopNode(gateWith({})).execute(ctxOf(shopProps({ products: [] }), sent)),
    ).toEqual({
      kind: 'advance',
      port: 2,
      branch: true,
    });
    const none = gateWith({ inStock: async () => new Set<string>() });
    expect(await new ShopNode(none).execute(ctxOf(shopProps(), sent))).toMatchObject({ port: 2 });
    expect(sent).toEqual([]);
  });

  it('offers only what is in stock, and everything when the store cannot say', async () => {
    const sent: OutboundMessage[] = [];
    const only = gateWith({ inStock: async () => new Set(['b']) });
    const r = await new ShopNode(only).execute(ctxOf(shopProps(), sent));
    expect(r).toMatchObject({ kind: 'wait', wait: { data: { products: [{ retailerId: 'b' }] } } });
    const broke = gateWith({
      inStock: async () => {
        throw new Error('down');
      },
    });
    const r2 = await new ShopNode(broke).execute(ctxOf(shopProps(), []));
    expect(r2).toMatchObject({ kind: 'wait', wait: { data: { products: [{}, {}] } } });
  });

  it('WhatsApp Shop on the Cloud API sends the native list and sends no cards; without one it falls back to cards', async () => {
    const sent: OutboundMessage[] = [];
    let native = 0;
    const gate = gateWith({
      sendNative: async () => {
        native++;
        return true;
      },
    });
    const props = shopProps({ provider: 'whatsapp_shop' });
    const cloud = { channelKind: 'whatsapp_cloud' };
    const r = await new ShopNode(gate).execute(ctxOf(props, sent, null, cloud));
    expect(native).toBe(1);
    expect(sent).toEqual([]);
    expect(r).toMatchObject({ kind: 'wait', wait: { data: { native: true } } });

    const fallback = await new ShopNode(gateWith({})).execute(ctxOf(props, sent, null, cloud));
    expect(sent.length).toBeGreaterThan(0);
    expect(fallback).toMatchObject({ kind: 'wait', wait: { data: { native: false } } });
  });

  const waiting = (over: Record<string, unknown> = {}): WaitSpec => ({
    nodeId: 'n',
    variable: 'commerce_choice',
    kind: 'Custom',
    handler: 'CommerceShop',
    data: {
      provider: 'shopify',
      storeId: '7',
      products: P,
      native: false,
      linkSent: false,
      ...over,
    },
  });
  const text = (t: string): InboundReply => ({ kind: 'text', id: '', text: t });

  it('a picked product gets a single-use link tagged with the run; later texts are not answered', async () => {
    const sent: OutboundMessage[] = [];
    const asked: unknown[] = [];
    const gate = gateWith({
      checkoutLink: async (_o, i) => {
        asked.push(i);
        return 'https://shop/checkout/xyz';
      },
    });
    const node = new ShopNode(gate);
    const d = await node.onReply(ctxOf(shopProps(), sent, waiting()), text('1'));
    expect(asked[0]).toMatchObject({
      retailerId: 'a',
      runRef: 'run-uuid',
      qty: 1,
      provider: 'shopify',
    });
    expect(sent[0]).toMatchObject({
      kind: 'text',
      body: expect.stringContaining('https://shop/checkout/xyz'),
    });
    expect(d).toMatchObject({
      action: 'stay',
      setVars: { commerce_choice: 'a' },
      data: { linkSent: true },
    });
    expect(
      await node.onReply(ctxOf(shopProps(), sent, waiting({ linkSent: true })), text('thanks')),
    ).toEqual({
      action: 'ignore',
    });
  });

  it('says so when the number is not on the list, or no link could be made, and keeps waiting', async () => {
    const sent: OutboundMessage[] = [];
    const node = new ShopNode(gateWith({}));
    expect(await node.onReply(ctxOf(shopProps(), sent, waiting()), text('7'))).toEqual({
      action: 'ignore',
    });
    expect(sent[0]).toMatchObject({
      body: "Sorry, I didn't catch that. Reply with a number from 1 to 2.",
    });
    const d = await node.onReply(ctxOf(shopProps(), sent, waiting()), text('2'));
    expect(sent[1]).toMatchObject({
      body: expect.stringContaining("couldn't generate a checkout link"),
    });
    expect(d).toMatchObject({
      action: 'stay',
      setVars: { commerce_choice: 'b' },
      data: { linkSent: false },
    });
  });

  it('an order from this run leaves by purchased with the order in the variables', async () => {
    const d = await new ShopNode(gateWith({})).onReply(ctxOf(shopProps(), [], waiting()), {
      kind: 'external',
      id: '',
      text: '',
      data: { order: { id: 'O-1', total: '499.00', currency: 'INR' } },
    });
    expect(d).toEqual({
      action: 'route',
      port: 1,
      setVars: { order_id: 'O-1', order_total: '499.00', order_currency: 'INR' },
    });
  });

  it('does not take typed answers on a native list', async () => {
    const d = await new ShopNode(gateWith({})).onReply(
      ctxOf(shopProps(), [], waiting({ native: true })),
      text('1'),
    );
    expect(d).toEqual({ action: 'ignore' });
  });
});

// --- the form node ------------------------------------------------------------------------------------------------------------

describe('the WhatsApp Form node (WD-FLR-043)', () => {
  const live = { id: 9, uuid: 'u', title: 'Lead', metaFlowId: 'flow-1' };
  const records = (form: typeof live | null) => ({ liveForm: async () => form }) as never;
  const props = { formId: '9', bodyText: 'Fill in', ctaLabel: 'Open form', flowVariable: 'lead' };
  const fctx = (sent: OutboundMessage[], channelKind = 'whatsapp_cloud', ok = true): NodeContext =>
    ({
      ...ctxOf(props, sent, null, { channelKind }),
      send: async (m: OutboundMessage) => {
        sent.push(m);
        return ok ? { ok: true } : { ok: false, error: 'refused', code: 'X', halt: false };
      },
    }) as NodeContext;

  it('sends the published form with a token for this run and waits for the submission', async () => {
    const sent: OutboundMessage[] = [];
    const r = await new FormNode(records(live)).execute(fctx(sent));
    expect(sent[0]).toEqual({
      kind: 'form',
      body: 'Fill in',
      flowId: 'flow-1',
      flowToken: formToken(9, 'run-uuid'),
      cta: 'Open form',
    });
    expect(r).toMatchObject({
      kind: 'wait',
      wait: {
        kind: 'Custom',
        handler: 'WaForm',
        data: { formId: 9, flowToken: 'form-9-run-uuid' },
      },
    });
  });

  it('skips a form that is missing, not published, or on a channel that cannot open it, and a refused send', async () => {
    const adv = { kind: 'advance', port: 1 };
    const sent: OutboundMessage[] = [];
    expect(await new FormNode(records(null)).execute(fctx(sent))).toEqual(adv);
    expect(await new FormNode(records(live)).execute(fctx(sent, 'telegram'))).toEqual(adv);
    expect(await new FormNode(records(live)).execute(fctx(sent, 'whatsapp_cloud', false))).toEqual(
      adv,
    );
    const noForm = ctxOf({ ...props, formId: '' }, sent, null, { channelKind: 'whatsapp_cloud' });
    expect(await new FormNode(records(live)).execute(noForm)).toEqual(adv);
  });

  it('a submission stores every answer under its id and form_<id>, and leaves by the only port', async () => {
    const wait: WaitSpec = {
      nodeId: 'n',
      variable: 'form_submission',
      kind: 'Custom',
      handler: 'WaForm',
      data: { formId: 9, flowToken: 'form-9-run-uuid', flowVariable: 'lead' },
    };
    const d = await new FormNode(records(live)).onReply(ctxOf(props, [], wait), {
      kind: 'external',
      id: '',
      text: '',
      data: {
        answers: {
          name: 'Asha',
          plan: { title: 'Gold', id: 'g' },
          tags: ['a', 'b'],
          __proto__x: 1,
        },
      },
    });
    expect(d).toMatchObject({
      action: 'route',
      port: 1,
      setVars: {
        name: 'Asha',
        form_name: 'Asha',
        plan: 'Gold',
        form_plan: 'Gold',
        tags: 'a, b',
        lead: { name: 'Asha', plan: 'Gold', tags: 'a, b' },
      },
    });
  });

  it('typing while the form is open is not an answer', async () => {
    expect(
      await new FormNode(records(live)).onReply(ctxOf(props, [], null), {
        kind: 'text',
        id: '',
        text: 'hi',
      }),
    ).toEqual({ action: 'ignore' });
  });

  it('flattens the shapes Meta sends and reads its own token back', () => {
    expect(flattenAnswer(null)).toBe('');
    expect(flattenAnswer({ value: 5 })).toBe('5');
    expect(flattenAnswer({ x: { y: 1 } })).toBe('{"x":{"y":1}}');
    expect(flattenAnswer([{ title: 'A' }, '', 'B'])).toBe('A, B');
    expect(parseFormToken('form-12-3f2a-9b')).toEqual({ formId: 12, runRef: '3f2a-9b' });
    expect(parseFormToken('other-12')).toBeNull();
  });
});
