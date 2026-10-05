import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORDERS_FILTERS,
  hasActiveFilter,
  isCalendarDay,
  isInvertedRange,
  ordersQuery,
  ordersSearch,
  parseOrdersFilters,
  resetOrdersFilters,
} from './orders-filters';

const SHOP = '0b0f7c2e-1c58-4d3b-9d2e-6a1f0c4b7a10';
const parse = (s: string) => parseOrdersFilters(new URLSearchParams(s));

describe('parseOrdersFilters', () => {
  it('an empty address is every default', () => {
    expect(parse('')).toEqual(DEFAULT_ORDERS_FILTERS);
  });

  it('reads every filter', () => {
    const f = parse(
      `status=paid&source=waba&pay=cod&from=2026-10-01&to=2026-10-05&q=%20ali%20&store=${SHOP}`,
    );
    expect(f).toEqual({
      status: 'paid',
      source: 'waba',
      paymentStatus: 'cod',
      from: '2026-10-01',
      to: '2026-10-05',
      q: 'ali',
      storefrontId: SHOP,
    });
  });

  it('drops values it does not know instead of failing', () => {
    const f = parse(
      'status=bogus&source=fax&pay=maybe&from=yesterday&to=2026-02-31&store=not-a-uuid',
    );
    expect(f).toEqual(DEFAULT_ORDERS_FILTERS);
  });

  it('caps a very long search at the API limit', () => {
    expect(parse(`q=${'a'.repeat(500)}`).q).toHaveLength(120);
  });

  it('ignores the store switcher parameter', () => {
    expect(parse('shop=abc')).toEqual(DEFAULT_ORDERS_FILTERS);
  });
});

describe('ordersQuery', () => {
  it('sends only the page size for no filters', () => {
    expect(ordersQuery(DEFAULT_ORDERS_FILTERS)).toEqual({ limit: 25 });
  });

  it('maps filters onto the API names', () => {
    const q = ordersQuery({
      status: 'shipped',
      source: 'storefront',
      paymentStatus: 'awaiting',
      from: '2026-10-01',
      to: '2026-10-05',
      q: ' 9198 ',
      storefrontId: SHOP,
    });
    expect(q).toEqual({
      limit: 25,
      status: 'shipped',
      source: 'storefront',
      paymentStatus: 'awaiting',
      from: '2026-10-01',
      to: '2026-10-05',
      q: '9198',
      storefrontId: SHOP,
    });
  });
});

describe('ordersSearch', () => {
  it('is empty with no filters and no shop', () => {
    expect(ordersSearch(DEFAULT_ORDERS_FILTERS)).toBe('');
  });

  it('keeps the shop switcher and leaves defaults out', () => {
    expect(ordersSearch({ ...DEFAULT_ORDERS_FILTERS, status: 'paid' }, SHOP)).toBe(
      `shop=${SHOP}&status=paid`,
    );
  });

  it('round-trips through parse', () => {
    const f = {
      status: 'new',
      source: 'manual',
      paymentStatus: 'unpaid',
      from: '2026-01-02',
      to: '2026-03-04',
      q: 'a&b c',
      storefrontId: SHOP,
    };
    expect(parse(ordersSearch(f, 'x'))).toEqual(f);
  });
});

describe('hasActiveFilter and reset', () => {
  it('is false for the defaults and true for any single filter', () => {
    expect(hasActiveFilter(DEFAULT_ORDERS_FILTERS)).toBe(false);
    for (const patch of [
      { status: 'paid' },
      { source: 'waba' },
      { paymentStatus: 'cod' },
      { from: '2026-10-01' },
      { to: '2026-10-01' },
      { q: 'x' },
      { storefrontId: SHOP },
    ]) {
      expect(hasActiveFilter({ ...DEFAULT_ORDERS_FILTERS, ...patch })).toBe(true);
    }
  });

  it('a search of spaces is not a filter', () => {
    expect(hasActiveFilter({ ...DEFAULT_ORDERS_FILTERS, q: '   ' })).toBe(false);
  });

  it('reset returns a fresh copy of the defaults', () => {
    const r = resetOrdersFilters();
    expect(r).toEqual(DEFAULT_ORDERS_FILTERS);
    expect(r).not.toBe(DEFAULT_ORDERS_FILTERS);
  });
});

describe('dates', () => {
  it('accepts only real calendar days', () => {
    expect(isCalendarDay('2026-02-28')).toBe(true);
    expect(isCalendarDay('2028-02-29')).toBe(true);
    expect(isCalendarDay('2026-02-29')).toBe(false);
    expect(isCalendarDay('2026-2-1')).toBe(false);
  });

  it('spots a range that ends before it starts', () => {
    expect(isInvertedRange({ from: '2026-10-05', to: '2026-10-01' })).toBe(true);
    expect(isInvertedRange({ from: '2026-10-01', to: '2026-10-01' })).toBe(false);
    expect(isInvertedRange({ from: '', to: '2026-10-01' })).toBe(false);
  });
});
