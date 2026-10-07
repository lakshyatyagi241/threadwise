import { describe, expect, it } from 'vitest';
import { v1ListQuerySchema } from '@crm/contracts';
import {
  ok,
  pageMeta,
  countMeta,
} from '../../../src/modules/developer-rest-api-v1/http/v1-envelope';

describe('v1 list query and envelope (WD-API-007)', () => {
  it('defaults to 25 and accepts per_page as limit', () => {
    expect(v1ListQuerySchema.parse({})).toEqual({ limit: 25, cursor: undefined });
    expect(v1ListQuerySchema.parse({ per_page: '10' }).limit).toBe(10);
    expect(v1ListQuerySchema.parse({ limit: '7', per_page: '10' }).limit).toBe(7);
  });

  it('pulls a size outside 1 to 100 into range, as WaDesk does, and refuses page numbers naming the cursor', () => {
    expect(v1ListQuerySchema.parse({ limit: '0' }).limit).toBe(1);
    expect(v1ListQuerySchema.parse({ limit: '-5' }).limit).toBe(1);
    expect(v1ListQuerySchema.parse({ per_page: '101' }).limit).toBe(100);
    expect(v1ListQuerySchema.parse({ per_page: '1000' }).limit).toBe(100);
    const page = v1ListQuerySchema.safeParse({ page: '2' });
    expect(page.success).toBe(false);
    if (!page.success) expect(page.error.issues[0]?.message).toContain('cursor');
  });

  it('casts the size like PHP (int) and clamps it, never refusing: abc is 1, 1.5 is 1, 12abc is 12, empty is 1 (WD-API-007)', () => {
    const size = (q: Record<string, unknown>) => v1ListQuerySchema.parse(q).limit;
    expect(size({ limit: 'abc' })).toBe(1);
    expect(size({ per_page: 'abc' })).toBe(1);
    expect(size({ limit: '1.5' })).toBe(1);
    expect(size({ limit: '-3' })).toBe(1);
    expect(size({ limit: '0' })).toBe(1);
    expect(size({ limit: '' })).toBe(1);
    expect(size({ limit: '12abc' })).toBe(12);
    expect(size({ limit: ' 7' })).toBe(7);
    expect(size({ limit: '1e2' })).toBe(100);
    expect(size({ limit: '99.9' })).toBe(99);
    expect(size({ limit: '100.5' })).toBe(100);
    expect(size({ limit: '99999999999999999999999' })).toBe(100);
    expect(size({ limit: ['3', '8'] })).toBe(8);
    expect(size({ limit: { a: 1 } })).toBe(1);
    expect(size({ per_page: 'abc', limit: '5' })).toBe(5);
  });

  it('refuses page with the cursor message even next to a bad size', () => {
    const r = v1ListQuerySchema.safeParse({ page: '1', limit: 'abc' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toEqual(['page']);
  });

  it('builds { data } with meta only when there is one', () => {
    expect(ok([1])).toEqual({ data: [1] });
    expect(ok([1], {})).toEqual({ data: [1] });
    expect(ok([1], countMeta(1))).toEqual({ data: [1], meta: { count: 1 } });
    expect(pageMeta({ nextCursor: 'c', hasMore: true, limit: 5 })).toEqual({
      limit: 5,
      next_cursor: 'c',
      has_more: true,
    });
  });
});
