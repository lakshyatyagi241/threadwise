import { describe, expect, it, vi } from 'vitest';
import { CatalogShopAdapter } from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/catalog-shop.adapter';
import { ShopGateBinder } from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/shop-binder';
import { FlowShopGate } from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/shop-port';

function build(rows: Array<Record<string, unknown>>, sent = 1) {
  const gate = new FlowShopGate();
  const db = {
    txAs: vi.fn(async (_c: unknown, fn: (tx: unknown) => unknown) =>
      fn({ execute: async () => ({ rows }) }),
    ),
  };
  const send = vi.fn().mockResolvedValue({ ok: sent > 0, sent, failed: 0, total: 1, errors: [] });
  const adapter = new CatalogShopAdapter(db as never, { send } as never);
  return { gate, adapter, send };
}

describe('the catalog behind the Commerce shop node (TW-FLR-041)', () => {
  it('the binder gives WhatsApp Shop to the catalog and the other providers to the store', async () => {
    const { gate, adapter } = build([{ meta_retailer_id: 'A' }]);
    const ecom = {
      inStock: vi.fn().mockResolvedValue(new Set(['W'])),
      sendNative: vi.fn().mockResolvedValue(true),
      checkoutLink: vi.fn().mockResolvedValue('https://pay'),
    };
    expect(gate.bound).toBe(false);
    new ShopGateBinder(gate, ecom as never, adapter).onModuleInit();
    expect(gate.bound).toBe(true);
    const input = { storeId: '', retailerIds: ['A'] };
    expect([...((await gate.inStock(1, { provider: 'whatsapp_shop', ...input })) ?? [])]).toEqual([
      'A',
    ]);
    expect([...((await gate.inStock(1, { provider: 'shopify', ...input })) ?? [])]).toEqual(['W']);
    expect(ecom.inStock).toHaveBeenCalledTimes(1);
    expect(await gate.checkoutLink(1, {} as never)).toBe('https://pay');
  });

  it('says what is in stock for WhatsApp Shop only; other stores answer "cannot say"', async () => {
    const { adapter } = build([{ meta_retailer_id: 'A' }]);
    const input = { storeId: '', retailerIds: ['A', 'B'] };
    expect([
      ...((await adapter.inStock(1, { provider: 'whatsapp_shop', ...input })) ?? []),
    ]).toEqual(['A']);
    expect(await adapter.inStock(1, { provider: 'woocommerce', ...input })).toBeNull();
    expect(
      await adapter.inStock(1, { provider: 'whatsapp_shop', storeId: '', retailerIds: [] }),
    ).toBeNull();
  });

  it('sends the native list through the catalog send in the offered order, one card for one product', async () => {
    const { adapter, send } = build([
      { uuid: 'u-b', meta_retailer_id: 'B' },
      { uuid: 'u-a', meta_retailer_id: 'A' },
    ]);
    const base = {
      provider: 'whatsapp_shop',
      header: 'Shop',
      body: 'Pick',
      footer: '',
      peerKey: '919800000001',
    };
    expect(
      await adapter.sendNative(1, {
        ...base,
        products: [{ retailerId: 'A' }, { retailerId: 'B' }],
      }),
    ).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'mpm',
        manualNumbers: '919800000001',
        productIds: ['u-a', 'u-b'],
        footer: null,
      }),
    );
    await adapter.sendNative(1, { ...base, products: [{ retailerId: 'A' }] });
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'spm', productIds: ['u-a'] }),
    );
  });

  it('cannot send for another store kind, for products the catalog lacks, or when the send fails', async () => {
    const none = build([]);
    expect(
      await none.adapter.sendNative(1, {
        provider: 'shopify',
        header: '',
        body: '',
        footer: '',
        peerKey: '1',
        products: [{ retailerId: 'A' }],
      }),
    ).toBe(false);
    expect(
      await none.adapter.sendNative(1, {
        provider: 'whatsapp_shop',
        header: '',
        body: '',
        footer: '',
        peerKey: '1',
        products: [{ retailerId: 'A' }],
      }),
    ).toBe(false);
    const fail = build([{ uuid: 'u-a', meta_retailer_id: 'A' }]);
    fail.send.mockRejectedValue(new Error('no catalog'));
    expect(
      await fail.adapter.sendNative(1, {
        provider: 'whatsapp_shop',
        header: '',
        body: '',
        footer: '',
        peerKey: '1',
        products: [{ retailerId: 'A' }],
      }),
    ).toBe(false);
    expect(await none.adapter.checkoutLink()).toBeNull();
  });
});
