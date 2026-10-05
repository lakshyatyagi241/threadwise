import { describe, expect, it } from 'vitest';
import {
  countsQuery,
  DEFAULT_FILTERS,
  filtersToSearch,
  hasActiveFilter,
  listQuery,
  orderedWindow,
  parseFilters,
} from './filters';
import { TABS } from './status';

const params = (s: string) => new URLSearchParams(s);
const ID = '00000000-0000-4000-8000-0000000000c1';

describe('invoice filters in the address', () => {
  it('the plain screen has a plain address', () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe('');
    expect(parseFilters(params(''))).toEqual(DEFAULT_FILTERS);
  });

  it('round-trips every filter', () => {
    const f = {
      tab: 'overdue',
      q: 'acme',
      contact: ID,
      issuedFrom: '2026-01-01',
      issuedTo: '2026-02-01',
      dueFrom: '2026-03-01',
      dueTo: '2026-04-01',
      currency: 'EUR',
      docType: 'proforma',
      mine: true,
      order: 'asc',
    } as const;
    expect(parseFilters(params(filtersToSearch(f)))).toEqual(f);
  });

  it('falls back to the defaults for junk instead of failing', () => {
    const f = parseFilters(
      params(
        'tab=nope&order=up&contact=12&issuedFrom=2026-13-45&dueTo=x&currency=eu&docType=quote&mine=yes&q=' +
          'x'.repeat(300),
      ),
    );
    expect(f).toMatchObject({
      tab: 'all',
      order: 'desc',
      contact: '',
      issuedFrom: '',
      dueTo: '',
      currency: '',
      docType: '',
      mine: false,
    });
    expect(f.q).toHaveLength(100);
  });

  it('upper-cases a currency', () => {
    expect(parseFilters(params('currency=kwd')).currency).toBe('KWD');
  });

  it('accepts every tab, partially_paid included', () => {
    for (const tab of TABS) expect(parseFilters(params(`tab=${tab}`)).tab).toBe(tab);
  });

  it('only the narrowing filters count as active (not the tab or the order)', () => {
    expect(hasActiveFilter(parseFilters(params('tab=paid&order=asc')))).toBe(false);
    expect(hasActiveFilter(parseFilters(params('q=a')))).toBe(true);
    expect(hasActiveFilter(parseFilters(params(`contact=${ID}`)))).toBe(true);
    expect(hasActiveFilter(parseFilters(params('mine=1')))).toBe(true);
    expect(hasActiveFilter(parseFilters(params('docType=receipt')))).toBe(true);
    expect(hasActiveFilter(parseFilters(params('dueFrom=2026-01-01')))).toBe(true);
  });
});

describe('invoice queries', () => {
  const f = parseFilters(
    params(
      `tab=partially_paid&q=%20acme%20&contact=${ID}&issuedFrom=2026-01-01&dueTo=2026-05-01&docType=proforma&mine=1&order=asc`,
    ),
  );
  it('the list carries the tab as the status and the narrowing filters under the API names', () => {
    expect(listQuery(f)).toEqual({
      q: 'acme',
      contactId: ID,
      issuedFrom: '2026-01-01',
      issuedTo: undefined,
      dueFrom: undefined,
      dueTo: '2026-05-01',
      currency: undefined,
      docType: 'proforma',
      mine: true,
      status: 'partially_paid',
      order: 'asc',
    });
  });
  it('"all" sends no status, and the default order sends none', () => {
    const q = listQuery(DEFAULT_FILTERS);
    expect(q.status).toBeUndefined();
    expect(q.order).toBeUndefined();
    expect(q.mine).toBeUndefined();
  });
  it('counts never take the tab or the order, so every badge answers for its own tab', () => {
    expect(countsQuery(f)).not.toHaveProperty('status');
    expect(countsQuery(f)).not.toHaveProperty('order');
    expect(countsQuery(f).contactId).toBe(ID);
    expect(countsQuery(f).mine).toBe(true);
  });
});

describe('orderedWindow', () => {
  it('swaps a window typed the wrong way round', () => {
    expect(orderedWindow('2026-03-01', '2026-02-01')).toEqual({
      from: '2026-02-01',
      to: '2026-03-01',
    });
    expect(orderedWindow('2026-02-01', '2026-03-01')).toEqual({
      from: '2026-02-01',
      to: '2026-03-01',
    });
    expect(orderedWindow('', '2026-03-01')).toEqual({ from: '', to: '2026-03-01' });
  });
});
