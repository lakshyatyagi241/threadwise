import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { ShopsService } from '../../../src/modules/storefront-builder/shops/shops.service';

/** A shop delete or reset must not remove orders that carry an invoice, a sales order or a payment (issue #1526). */
function build(financial: number) {
  const tx = {};
  const db = { tx: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const repo = {
    findByUuid: vi.fn(async () => ({ id: 3, shopName: 'Main', slug: 'main' })),
    deleteById: vi.fn(async () => undefined),
    deleteAll: vi.fn(async () => 0),
  };
  const orders = {
    countFinancial: vi.fn(async () => financial),
    deleteByStorefront: vi.fn(async () => 0),
    deleteAll: vi.fn(async () => 0),
  };
  const products = { deleteAllProducts: vi.fn(async () => 0) };
  const audit = { record: vi.fn(async () => undefined) };
  const outbox = { emit: vi.fn(async () => undefined) };
  const svc = new ShopsService(
    db as never,
    repo as never,
    {} as never,
    audit as never,
    outbox as never,
    {} as never,
    orders as never,
    {} as never,
  );
  Object.assign(svc, { products });
  return { svc, repo, orders };
}

const asOrg = <T>(fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: 'sf', orgId: 9, actorType: 'user', actorId: 1, userId: 1 },
    fn,
  );

describe('shop delete and reset keep financial orders', () => {
  it('refuses to delete a shop that has an invoiced, sales-linked or paid order, and deletes nothing', async () => {
    const { svc, repo, orders } = build(2);
    const err = await asOrg(() => svc.remove('shop-uuid')).catch((e: unknown) => e as AppError);
    expect(err.code).toBe(ERROR_CODES.CONFLICT);
    expect(orders.countFinancial).toHaveBeenCalledWith(expect.anything(), 9, 3);
    expect(orders.deleteByStorefront).not.toHaveBeenCalled();
    expect(repo.deleteById).not.toHaveBeenCalled();
  });

  it('deletes a shop whose orders have no financial link, as before', async () => {
    const { svc, repo, orders } = build(0);
    await asOrg(() => svc.remove('shop-uuid'));
    expect(orders.deleteByStorefront).toHaveBeenCalledTimes(1);
    expect(repo.deleteById).toHaveBeenCalledTimes(1);
  });

  it('refuses the reset while any order in the workspace is financial, before wiping anything', async () => {
    const { svc, orders, repo } = build(1);
    const err = await asOrg(() => svc.reset({ confirm: 'yes' } as never)).catch(
      (e: unknown) => e as AppError,
    );
    expect(err.code).toBe(ERROR_CODES.CONFLICT);
    expect(orders.countFinancial).toHaveBeenCalledWith(expect.anything(), 9, null);
    expect(orders.deleteAll).not.toHaveBeenCalled();
    expect(repo.deleteAll).not.toHaveBeenCalled();
  });
});

type AppError = { code: string };
