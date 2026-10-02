import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, PAGE_SIZES } from '../api/contacts';
import { filtersToSearch, parseFilters } from './filters';
import { defaultPageSize, PAGE_SIZE_KEY, parsePageSize } from './page-size';

describe('page size', () => {
  it('offers 10, 25, 50, 100 and 200', () => {
    expect([...PAGE_SIZES]).toEqual([10, 25, 50, 100, 200]);
  });

  it('keeps the remembered size under a stable key', () => {
    expect(PAGE_SIZE_KEY).toBe('cat:contacts:pageSize');
  });

  it('reads a remembered size and ignores anything else', () => {
    expect(parsePageSize('200')).toBe(200);
    expect(parsePageSize('25')).toBe(25);
    expect(parsePageSize('500')).toBeNull();
    expect(parsePageSize('abc')).toBeNull();
    expect(parsePageSize(null)).toBeNull();
    expect(defaultPageSize('junk')).toBe(DEFAULT_FILTERS.limit);
    expect(defaultPageSize('100')).toBe(100);
  });

  it('uses the remembered size when the URL has no per=, and the URL when it has', () => {
    expect(parseFilters(new URLSearchParams(''), 200).limit).toBe(200);
    expect(parseFilters(new URLSearchParams('per=50'), 200).limit).toBe(50);
    expect(parseFilters(new URLSearchParams('per=7'), 200).limit).toBe(200);
  });

  it('writes per= only when it differs from the remembered size, so the URL round-trips', () => {
    const f = { ...DEFAULT_FILTERS, limit: 200 as const };
    expect(filtersToSearch(f, 200)).toBe('');
    expect(filtersToSearch(f, 10)).toBe('?per=200');
    expect(parseFilters(new URLSearchParams(filtersToSearch(f, 10).slice(1)), 10).limit).toBe(200);
  });
});
