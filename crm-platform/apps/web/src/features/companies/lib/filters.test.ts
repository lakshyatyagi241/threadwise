import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  filtersToSearch,
  hasActiveFilter,
  listQuery,
  parseFilters,
  statsQuery,
} from './filters';

const params = (s: string) => new URLSearchParams(s);
const UUID = '11111111-1111-4111-8111-111111111111';

describe('parseFilters (the address is the state)', () => {
  it('an empty address is the defaults: newest first, no filter', () => {
    expect(parseFilters(params(''))).toEqual(DEFAULT_FILTERS);
  });

  it('reads every filter', () => {
    expect(
      parseFilters(params(`q=acme&owner=${UUID}&industry=Retail&openDeals=1&sort=name`)),
    ).toEqual({ q: 'acme', owner: UUID, industry: 'Retail', openDeals: true, sort: 'name' });
  });

  it('drops what it does not understand instead of failing', () => {
    const f = parseFilters(params('owner=not-a-uuid&sort=biggest&openDeals=yes'));
    expect(f).toEqual(DEFAULT_FILTERS);
  });

  it('keeps the "nobody owns it" owner and caps the search at 100 characters', () => {
    expect(parseFilters(params('owner=none')).owner).toBe('none');
    expect(parseFilters(params(`q=${'x'.repeat(300)}`)).q).toHaveLength(100);
  });
});

describe('filtersToSearch', () => {
  it('writes nothing for the defaults, and only what differs otherwise', () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe('');
    expect(filtersToSearch({ ...DEFAULT_FILTERS, q: ' acme ', sort: 'name' })).toBe(
      '?q=acme&sort=name',
    );
    expect(filtersToSearch({ ...DEFAULT_FILTERS, openDeals: true, owner: 'none' })).toBe(
      '?owner=none&openDeals=1',
    );
  });

  it('round-trips through parseFilters', () => {
    const f = {
      q: 'a&b',
      owner: UUID,
      industry: 'Food & Drink',
      openDeals: true,
      sort: 'name' as const,
    };
    expect(parseFilters(params(filtersToSearch(f)))).toEqual(f);
  });
});

describe('the requests', () => {
  it('maps the filters to the API query; "no owner" is `unassigned`, not an id', () => {
    const f = {
      ...DEFAULT_FILTERS,
      q: ' acme ',
      owner: 'none',
      industry: 'Retail',
      openDeals: true,
    };
    expect(listQuery(f)).toEqual({
      q: 'acme',
      ownerId: undefined,
      unassigned: true,
      industry: 'Retail',
      hasOpenDeals: true,
      sort: 'created',
    });
    expect(statsQuery({ ...f, owner: UUID })).toMatchObject({
      ownerId: UUID,
      unassigned: undefined,
    });
  });

  it('the tiles take the same filters as the list but no sort', () => {
    expect('sort' in statsQuery({ ...DEFAULT_FILTERS, sort: 'name' })).toBe(false);
    expect(listQuery({ ...DEFAULT_FILTERS, sort: 'name' }).sort).toBe('name');
  });

  it('a blank filter is not sent', () => {
    const q = listQuery(DEFAULT_FILTERS);
    expect(q).toEqual({
      q: undefined,
      ownerId: undefined,
      unassigned: undefined,
      industry: undefined,
      hasOpenDeals: undefined,
      sort: 'created',
    });
  });
});

describe('hasActiveFilter (no match vs no companies yet)', () => {
  it('is false for the defaults and for a sort alone, true for anything that narrows', () => {
    expect(hasActiveFilter(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, sort: 'name' })).toBe(false);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, q: '  ' })).toBe(false);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, q: 'a' })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, owner: 'none' })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, industry: 'x' })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, openDeals: true })).toBe(true);
  });
});
