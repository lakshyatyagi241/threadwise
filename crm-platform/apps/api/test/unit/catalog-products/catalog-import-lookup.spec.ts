import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { CatalogSyncService } from '../../../src/modules/catalog-products/catalog-sync.service';

/**
 * `importFromMeta` used to look up each product Meta listed with two queries of its own (the product by retailer id, then its
 * variants), so a catalog of N products cost 2N reads before any write (QA task 43). It now reads them all once. This drives the real
 * service with stubbed collaborators and checks the read count AND that every branch of the old loop still behaves the same.
 */
type Listed = { retailerId: string; name: string; price?: string; currency?: string };

function harness(opts: {
  listed: Listed[];
  held?: Array<{ id: number; retailer: string; variants?: number }>;
  withVariantsIds?: number[];
}) {
  const held = new Map(
    (opts.held ?? []).map((h) => [
      h.retailer,
      { id: h.id, metaRetailerId: h.retailer, variants: Array(h.variants ?? 0).fill({}) },
    ]),
  );
  let nextId = 1000;
  const inserted: Array<{ retailer: string; id: number }> = [];
  const findByRetailerIds = vi.fn(async (_tx: unknown, _org: number, ids: readonly string[]) => {
    const out = new Map<string, unknown>();
    for (const id of new Set(ids)) {
      const made = inserted.find((i) => i.retailer === id);
      const row = held.get(id) ?? (made && { id: made.id, metaRetailerId: id, variants: [] });
      if (row) out.set(id, row);
    }
    return out;
  });
  const withVariants = vi.fn(async (_tx: unknown, _org: number, rows: unknown[]) => rows);
  const update = vi.fn(async () => undefined);
  const insert = vi.fn(async (_tx: unknown, _org: number, row: { meta_retailer_id: string }) => {
    inserted.push({ retailer: row.meta_retailer_id, id: nextId++ });
  });
  const service = Object.create(CatalogSyncService.prototype) as CatalogSyncService;
  Object.assign(service, {
    tx: async (_org: number, fn: (t: unknown) => Promise<unknown>) => fn({}),
    catalogs: { first: async () => ({ id: 9, uuid: 'cat-uuid' }) },
    bindings: { of: () => ({}) },
    provider: { listProducts: async () => opts.listed },
    repo: { findByRetailerIds },
    products: { withVariants, update, insert, slugsLike: async () => new Set<string>() },
    audit: { record: vi.fn(async () => undefined) },
    outbox: { emit: vi.fn(async () => undefined) },
    ownVariantItems: async () => ({
      variantIds: new Set<string>(),
      withVariants: new Set<number>(opts.withVariantsIds ?? []),
    }),
  });
  const run = () =>
    RequestContextStore.run(
      { requestId: 'r', orgId: 7, actorType: 'user', actorId: 3, userId: 3 },
      () => service.importFromMeta(7),
    );
  return { run, findByRetailerIds, withVariants, update, insert };
}

const item = (n: number | string): Listed => ({
  retailerId: `R-${n}`,
  name: `Product ${n}`,
  price: '10.00',
  currency: 'USD',
});

describe('catalog import reads what it already holds once', () => {
  it('500 new products cost one lookup and one variants read, not 1000', async () => {
    const h = harness({ listed: Array.from({ length: 500 }, (_, i) => item(i)) });
    const out = await h.run();
    expect(out).toMatchObject({ imported: 500, updated: 0, skipped: 0, total: 500 });
    expect(h.findByRetailerIds).toHaveBeenCalledTimes(1);
    expect(h.withVariants).toHaveBeenCalledTimes(1);
    expect(h.insert).toHaveBeenCalledTimes(500);
  });

  it('updates the ones it holds and creates the rest', async () => {
    const h = harness({
      listed: [item(1), item(2), item(3)],
      held: [
        { id: 11, retailer: 'R-1' },
        { id: 12, retailer: 'R-2' },
      ],
    });
    expect(await h.run()).toMatchObject({ imported: 1, updated: 2, skipped: 0, total: 3 });
    expect(h.update).toHaveBeenCalledTimes(2);
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect((h.update.mock.calls as unknown[][]).map((c) => c[2]).sort()).toEqual([11, 12]);
  });

  it('skips a product that has variants: Meta must not overwrite the aggregate', async () => {
    const h = harness({
      listed: [item(1), item(2)],
      held: [
        { id: 11, retailer: 'R-1', variants: 2 },
        { id: 12, retailer: 'R-2' },
      ],
    });
    expect(await h.run()).toMatchObject({ imported: 0, updated: 1, skipped: 1 });
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it('skips the hidden twin of a product this workspace pushed with variants', async () => {
    const h = harness({
      listed: [item(1)],
      held: [{ id: 11, retailer: 'R-1' }],
      withVariantsIds: [11],
    });
    expect(await h.run()).toMatchObject({ imported: 0, updated: 0, skipped: 1 });
    expect(h.update).not.toHaveBeenCalled();
  });

  it('skips blank retailer ids and blank names, and never looks the blank id up', async () => {
    const h = harness({
      listed: [{ retailerId: '  ', name: 'x' }, { retailerId: 'R-1', name: '   ' }, item(2)],
    });
    expect(await h.run()).toMatchObject({ imported: 1, skipped: 2, total: 3 });
    expect((h.findByRetailerIds.mock.calls as unknown[][])[0]![2]).toEqual(['R-1', 'R-2']);
  });

  it('the same retailer id twice in one listing: the first creates it, the second updates that row', async () => {
    const h = harness({ listed: [item(1), item(1)] });
    expect(await h.run()).toMatchObject({ imported: 1, updated: 1, skipped: 0 });
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledTimes(1);
    // The repeat is the only extra read, and only because a new product appeared in this run.
    expect(h.findByRetailerIds).toHaveBeenCalledTimes(2);
  });

  it('an empty listing reads nothing and reports zero', async () => {
    const h = harness({ listed: [] });
    expect(await h.run()).toMatchObject({ imported: 0, updated: 0, skipped: 0, total: 0 });
    expect(h.insert).not.toHaveBeenCalled();
  });
});
