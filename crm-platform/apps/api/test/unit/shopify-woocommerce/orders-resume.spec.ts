import { describe, expect, it, vi } from 'vitest';
import { ImportService } from '../../../src/modules/shopify-woocommerce/import.service';

/**
 * A WooCommerce import that the page cap cut short resumes on the next import from the page it stopped at, instead of re-reading
 * page 1 and never reaching the oldest orders. Regression for the shopify-woocommerce issue about the 10-page cap.
 */
function build(syncStats: Record<string, number> | null, orders: ReturnType<typeof vi.fn>) {
  const row = {
    uuid: 'store-uuid',
    storeUrl: 'https://shop.example',
    consumerKey: 'ck',
    consumerSecret: 'cs',
    storeCurrency: 'USD',
    userId: 1,
    metadata: null,
    syncStats,
  };
  const api = {
    products: vi.fn(async () => ({ items: [], complete: true })),
    orders,
    customers: vi.fn(async () => ({ items: [], complete: true })),
  };
  const repo = {
    wooById: vi.fn(async () => row),
    setSynced: vi.fn(async () => undefined),
    mergeMetadata: vi.fn(async () => undefined),
  };
  const service = new ImportService(
    { txAs: vi.fn(async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({})) } as never,
    repo as never,
    { publicCurrent: vi.fn(async () => null) } as never,
    { decrypt: (s: string) => s } as never,
    { store: vi.fn() } as never,
    { store: vi.fn(() => api) } as never,
    {
      ensureGroup: vi.fn(async () => 7),
      upsertProduct: vi.fn(),
      upsertOrder: vi.fn(),
      upsertCustomer: vi.fn(),
    } as never,
    {} as never,
  );
  return { service, repo };
}

describe('WooCommerce order import resumes past the page cap', () => {
  it('starts at page 1 and stores the page the cap stopped at', async () => {
    const orders = vi.fn(async () => ({ items: [], complete: false, nextPage: 11 }));
    const { service, repo } = build(null, orders);
    const stats = await service.run(9, 'woocommerce' as never, 3);
    expect(orders).toHaveBeenCalledWith(1);
    expect(stats).toMatchObject({ incomplete: 1, ordersPage: 11 });
    expect(repo.setSynced.mock.calls[0]?.[4]).toMatchObject({ incomplete: 1, ordersPage: 11 });
  });

  it('the next import reads from the stored page, and a finished read starts over at page 1', async () => {
    const orders = vi.fn(async () => ({ items: [], complete: true }));
    const { service, repo } = build({ orders: 1000, ordersPage: 11 }, orders);
    const stats = await service.run(9, 'woocommerce' as never, 3);
    expect(orders).toHaveBeenCalledWith(11);
    expect(stats).toMatchObject({ incomplete: 0, ordersPage: 1 });
    expect(repo.setSynced.mock.calls[0]?.[4]).toMatchObject({ ordersPage: 1 });
  });

  it('a stored cursor that is not a page number starts from page 1', async () => {
    const orders = vi.fn(async () => ({ items: [], complete: true }));
    const { service } = build({ ordersPage: -4 }, orders);
    await service.run(9, 'woocommerce' as never, 3);
    expect(orders).toHaveBeenCalledWith(1);
  });
});
