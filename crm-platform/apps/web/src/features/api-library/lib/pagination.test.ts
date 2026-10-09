import { describe, expect, it } from 'vitest';
import {
  clampPage,
  formatTotal,
  normalizePage,
  pageToFallBackTo,
  pageWindow,
  parseLimit,
  parsePage,
  rangeOf,
} from './pagination';

describe('query string', () => {
  it.each([
    ['2', 2],
    ['1', 1],
    ['0', 1],
    ['-3', 1],
    ['1.5', 1],
    ['abc', 1],
    ['', 1],
    [null, 1],
    [undefined, 1],
  ])('page %j is %i', (v, n) => expect(parsePage(v as string | null)).toBe(n));

  it.each([
    ['10', 10],
    ['25', 25],
    ['50', 50],
    ['100', 100],
    ['20', 25],
    ['1000', 25],
    ['x', 25],
    [null, 25],
  ])('limit %j is %i', (v, n) => expect(parseLimit(v as string | null)).toBe(n));
});

describe('pageWindow', () => {
  it('lists every page when there are few', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('slides a run with ellipsis on both sides', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
    expect(pageWindow(10, 20)).toEqual([1, 'gap', 8, 9, 10, 11, 12, 'gap', 20]);
    expect(pageWindow(20, 20)).toEqual([1, 'gap', 16, 17, 18, 19, 20]);
  });
  it('shows a single skipped page instead of an ellipsis', () => {
    expect(pageWindow(5, 20)).toEqual([1, 2, 3, 4, 5, 6, 7, 'gap', 20]);
    expect(pageWindow(16, 20)).toEqual([1, 'gap', 14, 15, 16, 17, 18, 19, 20]);
  });
});

describe('ranges and fallbacks', () => {
  it('names the rows of a page', () => {
    expect(rangeOf(1, 25, 25, 53)).toEqual({ from: 1, to: 25, total: 53 });
    expect(rangeOf(3, 25, 3, 53)).toEqual({ from: 51, to: 53, total: 53 });
    expect(rangeOf(1, 25, 0, 0)).toEqual({ from: 0, to: 0, total: 0 });
  });
  it('goes back to the last real page when the asked one is empty', () => {
    expect(pageToFallBackTo(5, 3)).toBe(3);
    expect(pageToFallBackTo(3, 3)).toBeNull();
    expect(pageToFallBackTo(2, 0)).toBe(1);
    expect(pageToFallBackTo(1, 0)).toBeNull();
  });
  it('clamps', () => {
    expect(clampPage(9, 3)).toBe(3);
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(NaN, 3)).toBe(1);
  });
});

describe('normalizePage', () => {
  const asked = { page: 2, limit: 25 };
  it('reads the totals from the top level or from page', () => {
    expect(
      normalizePage(
        {
          data: ['a'],
          page: { page: 2, pageSize: 25, total: 30, totalPages: 2 },
          total: 30,
          pageSize: 25,
          totalPages: 2,
        },
        asked,
      ),
    ).toEqual({ data: ['a'], total: 30, page: 2, pageSize: 25, totalPages: 2 });
    expect(
      normalizePage({ data: [], page: { page: 3, pageSize: 10, total: 21, totalPages: 3 } }, asked),
    ).toMatchObject({ total: 21, page: 3, pageSize: 10, totalPages: 3 });
  });
  it('falls back to what was asked when the server sent no totals', () => {
    expect(normalizePage({ data: ['a', 'b'], page: {} }, asked)).toEqual({
      data: ['a', 'b'],
      total: 2,
      page: 2,
      pageSize: 25,
      totalPages: 1,
    });
  });
});

describe('formatTotal', () => {
  it('groups digits and marks the count cap', () => {
    expect(formatTotal(53)).toBe('53');
    expect(formatTotal(12345)).toBe('12,345');
    expect(formatTotal(99999)).toBe('99,999');
    expect(formatTotal(100000)).toBe('100,000+');
  });
});
