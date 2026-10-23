import { describe, expect, it } from 'vitest';
import {
  EMPTY_EXPENSE_FILTERS,
  expenseRangeInverted,
  expenseSingleDay,
  parseExpenseFilters,
  toExpenseApiQuery,
  toExpenseSearch,
} from './expense-filters';

const params = (q: string) => new URLSearchParams(q);

describe('expense filters in the address', () => {
  it('reads every filter and ignores anything it cannot read', () => {
    const f = parseExpenseFilters(
      params(
        'status=refunded&from=2026-10-01&to=bad&template=%20order_update%20&source=campaign&category=utility&groupBy=country',
      ),
    );
    expect(f).toEqual({
      status: 'refunded',
      from: '2026-10-01',
      to: '',
      template: 'order_update',
      source: 'campaign',
      category: 'utility',
      groupBy: 'country',
    });
    expect(parseExpenseFilters(params('status=bogus&groupBy=nope'))).toMatchObject({
      status: 'all',
      groupBy: 'template',
    });
  });

  it('sends only what is set to the API, and never the grouping', () => {
    expect(toExpenseApiQuery(EMPTY_EXPENSE_FILTERS)).toEqual({
      status: undefined,
      from: undefined,
      to: undefined,
      template: undefined,
      source: undefined,
      category: undefined,
    });
    expect(
      toExpenseApiQuery({ ...EMPTY_EXPENSE_FILTERS, status: 'free', groupBy: 'category' }),
    ).toMatchObject({ status: 'free' });
    expect(toExpenseApiQuery({ ...EMPTY_EXPENSE_FILTERS, groupBy: 'category' })).not.toHaveProperty(
      'groupBy',
    );
  });

  it('writes the address back, and leaves the default grouping out of it', () => {
    expect(toExpenseSearch(EMPTY_EXPENSE_FILTERS)).toBe('');
    expect(toExpenseSearch({ ...EMPTY_EXPENSE_FILTERS, groupBy: 'template' })).toBe('');
    const f = {
      ...EMPTY_EXPENSE_FILTERS,
      status: 'charged' as const,
      template: 'promo',
      groupBy: 'source' as const,
    };
    const search = toExpenseSearch(f);
    expect(search).toBe('?status=charged&template=promo&groupBy=source');
    expect(parseExpenseFilters(new URLSearchParams(search.slice(1)))).toEqual(f);
  });

  it('flags a range that ends before it starts', () => {
    expect(
      expenseRangeInverted({ ...EMPTY_EXPENSE_FILTERS, from: '2026-10-05', to: '2026-10-01' }),
    ).toBe(true);
    expect(
      expenseRangeInverted({ ...EMPTY_EXPENSE_FILTERS, from: '2026-10-01', to: '2026-10-05' }),
    ).toBe(false);
  });

  it('names the day only when the range is one day (what View details sets)', () => {
    expect(
      expenseSingleDay({ ...EMPTY_EXPENSE_FILTERS, from: '2026-10-19', to: '2026-10-19' }),
    ).toBe('2026-10-19');
    expect(
      expenseSingleDay({ ...EMPTY_EXPENSE_FILTERS, from: '2026-10-18', to: '2026-10-19' }),
    ).toBe('');
    expect(expenseSingleDay(EMPTY_EXPENSE_FILTERS)).toBe('');
  });
});
