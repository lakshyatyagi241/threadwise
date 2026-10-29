import { describe, expect, it, vi } from 'vitest';
import { AdminBillingRepository } from '../../../src/modules/platform-payment-gateways/admin-billing.repository';

const range = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z') };
const filter = { ...range, type: 'all' as const, limit: 25 };

/** A transaction whose execute() answers each call from a queue of result rows. */
function fakeTx(...results: Array<Array<Record<string, unknown>>>) {
  const execute = vi.fn();
  for (const rows of results) execute.mockResolvedValueOnce({ rows });
  return { tx: { execute } as never, execute };
}

describe('AdminBillingRepository.listOrders total', () => {
  it('reports the window count when the page has rows', async () => {
    const { tx, execute } = fakeTx([{ uuid: 'a', order_number: 'N1', total_rows: '3' }]);
    const r = await new AdminBillingRepository().listOrders(tx, { ...filter, offset: 0 });
    expect(r.total).toBe(3);
    expect(r.rows).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('reports 0 without a second query when the first page is empty', async () => {
    const { tx, execute } = fakeTx([]);
    const r = await new AdminBillingRepository().listOrders(tx, { ...filter, offset: 0 });
    expect(r).toEqual({ rows: [], total: 0 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('counts the filtered set when a page past the last row is empty', async () => {
    // The page query returns no rows; the count query (same filters, no paging) returns the real total.
    const { tx, execute } = fakeTx([], [{ uuid: 'a', order_number: 'N1', total_rows: '3' }]);
    const r = await new AdminBillingRepository().listOrders(tx, { ...filter, offset: 50 });
    expect(r).toEqual({ rows: [], total: 3 });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
