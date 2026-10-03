import { describe, expect, it } from 'vitest';
import {
  pageWindow,
  parseProductsState,
  parseReviewTab,
  productsStateToSearch,
  reviewsStateToSearch,
  totalPages,
} from './pages';

describe('totalPages', () => {
  it('is at least one and rounds up', () => {
    expect(totalPages(0, 25)).toBe(1);
    expect(totalPages(25, 25)).toBe(1);
    expect(totalPages(26, 25)).toBe(2);
    expect(totalPages(251, 25)).toBe(11);
  });
});

describe('pageWindow', () => {
  it('lists every page when there are few', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });
  it('keeps first, last and two either side with gaps between', () => {
    expect(pageWindow(10, 20)).toEqual([1, 'gap', 8, 9, 10, 11, 12, 'gap', 20]);
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 'gap', 20]);
    expect(pageWindow(20, 20)).toEqual([1, 'gap', 18, 19, 20]);
  });
});

describe('products state', () => {
  it('reads q and page from the address, ignoring bad pages', () => {
    expect(parseProductsState(new URLSearchParams('q=tee&page=3'))).toEqual({ q: 'tee', page: 3 });
    expect(parseProductsState(new URLSearchParams('page=abc'))).toEqual({ q: '', page: 1 });
    expect(parseProductsState(new URLSearchParams('page=-2'))).toEqual({ q: '', page: 1 });
    expect(parseProductsState(new URLSearchParams('q=%20tee%20'))).toEqual({ q: 'tee', page: 1 });
  });
  it('writes only what differs from the default', () => {
    expect(productsStateToSearch({ q: '', page: 1 })).toBe('');
    expect(productsStateToSearch({ q: 'tee', page: 1 })).toBe('?q=tee');
    expect(productsStateToSearch({ q: 'a b', page: 2 })).toBe('?q=a+b&page=2');
  });
});

describe('review tabs', () => {
  it('falls back to pending for an unknown status', () => {
    expect(parseReviewTab('approved')).toBe('approved');
    expect(parseReviewTab('rejected')).toBe('rejected');
    expect(parseReviewTab('bogus')).toBe('pending');
    expect(parseReviewTab(null)).toBe('pending');
  });
  it('keeps pending and page 1 out of the address', () => {
    expect(reviewsStateToSearch('pending', 1)).toBe('');
    expect(reviewsStateToSearch('approved', 1)).toBe('?status=approved');
    expect(reviewsStateToSearch('rejected', 3)).toBe('?status=rejected&page=3');
  });
});
