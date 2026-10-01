import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<string | undefined> = [];

vi.mock('@/lib/api/client', () => ({
  // Three pages of two rows: cursors c1 -> page 2, c2 -> page 3.
  apiFetch: vi.fn(async (_path: string, opts: { query: { cursor?: string } }) => {
    const cursor = opts.query.cursor;
    calls.push(cursor);
    const idx = cursor === undefined ? 0 : cursor === 'c1' ? 1 : 2;
    const next = idx === 0 ? 'c1' : idx === 1 ? 'c2' : null;
    return {
      data: [{ id: `r${idx * 2}` }, { id: `r${idx * 2 + 1}` }],
      page: { nextCursor: next, hasMore: next !== null, limit: 2 },
      meta: { total: 6 },
    };
  }),
}));

import { DEFAULT_FILTERS, listQuery, loadContactPage } from './contacts';

const query = listQuery({ ...DEFAULT_FILTERS, limit: 10 });

describe('loadContactPage', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('loads the first page without a cursor', async () => {
    const qc = new QueryClient();
    const r = await loadContactPage(qc, query, 0);
    expect(r.index).toBe(0);
    expect(calls).toEqual([undefined]);
  });

  it('steps to the next page with one request once the previous page is cached', async () => {
    const qc = new QueryClient();
    await loadContactPage(qc, query, 0);
    calls.length = 0;
    const r = await loadContactPage(qc, query, 1);
    expect(r.index).toBe(1);
    expect(calls).toEqual(['c1']);
  });

  it('walks the pages in between when jumping ahead, caching each', async () => {
    const qc = new QueryClient();
    const r = await loadContactPage(qc, query, 2);
    expect(r.index).toBe(2);
    expect(calls).toEqual([undefined, 'c1', 'c2']);
    // The pages passed on the way are cached, so going back costs nothing.
    calls.length = 0;
    expect(qc.getQueriesData({ queryKey: ['cat', 'contacts', 'page'] })).toHaveLength(3);
    const again = await loadContactPage(qc, query, 2);
    expect(again.index).toBe(2);
    expect(calls).toEqual(['c2']);
  });

  it('lands on the last page when asked for one past the end', async () => {
    const qc = new QueryClient();
    const r = await loadContactPage(qc, query, 9);
    expect(r.index).toBe(2);
    expect(r.response.page.hasMore).toBe(false);
  });
});
