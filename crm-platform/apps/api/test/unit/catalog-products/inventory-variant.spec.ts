import { describe, expect, it } from 'vitest';
import {
  afterCommit,
  afterHold,
  afterRelease,
  canHold,
  type Stock,
} from '../../../src/modules/catalog-products/inventory-rules';

/** The same arithmetic serves a variant's stock row (invariant 4); these pin the cases the variant path relies on. */
describe('stock arithmetic on a variant row', () => {
  it('hold, commit and release keep stock and holds consistent', () => {
    let s: Stock = { stockQty: 3, reservedQty: 0 };
    expect(canHold(s, 3)).toBe(true);
    s = afterHold(s, 2);
    expect(canHold(s, 2)).toBe(false);
    expect(afterRelease(s, 2)).toEqual({ stockQty: 3, reservedQty: 0 });
    expect(afterCommit(s, 2)).toEqual({ stockQty: 1, reservedQty: 0 });
  });
  it('unlimited variant never decrements', () => {
    const s = afterHold({ stockQty: null, reservedQty: 0 }, 4);
    expect(afterCommit(s, 4)).toEqual({ stockQty: null, reservedQty: 0 });
  });
});
