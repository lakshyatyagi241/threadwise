import { describe, expect, it } from 'vitest';
import {
  bulkAllowed,
  EMPTY_FILTERS,
  flowMissing,
  hasFilters,
  indexingShares,
  pruneSelection,
  toggleAll,
  toListQuery,
} from './list-model';

describe('list model', () => {
  it('builds a query of only what is set', () => {
    expect(
      toListQuery({ ...EMPTY_FILTERS, status: 'paused', indexing: 'failed' }, ' hello '),
    ).toEqual({
      search: 'hello',
      status: 'paused',
      category: undefined,
      indexing: 'failed',
    });
    expect(hasFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasFilters({ ...EMPTY_FILTERS, category: 'Billing' })).toBe(true);
  });
  it('shares add to 100 and an empty FAQ has none', () => {
    const s = indexingShares({ readyCount: 5, pendingCount: 1, failedCount: 1 });
    expect(s.ready + s.pending + s.failed).toBe(100);
    expect(indexingShares({ readyCount: 0, pendingCount: 0, failedCount: 0 }).total).toBe(0);
  });
  it('warns on a flow FAQ whose flow is gone', () => {
    expect(flowMissing({ answerType: 'flow', flowName: null })).toBe(true);
    expect(flowMissing({ answerType: 'text', flowName: null })).toBe(false);
  });
  it('respects permissions for bulk actions', () => {
    expect(bulkAllowed({ update: true, delete: false })).toEqual({
      pause: true,
      activate: true,
      delete: false,
    });
    expect(bulkAllowed({ update: false, delete: true }).delete).toBe(false);
  });
  it('keeps the selection tidy', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect([...pruneSelection(new Set(['a', 'z']), rows)]).toEqual(['a']);
    expect(toggleAll(new Set(), rows).size).toBe(2);
    expect(toggleAll(new Set(['a', 'b']), rows).size).toBe(0);
  });
});
