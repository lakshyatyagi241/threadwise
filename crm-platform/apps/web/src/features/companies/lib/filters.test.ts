import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  filtersToSearch,
  hasActiveFilter,
  listQuery,
  parseFilters,
  parseProps,
  sortFromValue,
  sortValue,
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
    ).toEqual({
      ...DEFAULT_FILTERS,
      q: 'acme',
      owner: UUID,
      industry: 'Retail',
      openDeals: true,
      sort: 'name',
    });
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
      props: [{ key: 'tier', operator: 'equals' as const, value: 'gold' }],
      sort: 'property' as const,
      sortKey: 'tier',
      sortDir: 'desc' as const,
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
      props: undefined,
      sort: 'created',
      sortKey: undefined,
      sortDir: undefined,
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
      props: undefined,
      sort: 'created',
      sortKey: undefined,
      sortDir: undefined,
    });
  });
});

describe('company property conditions and orders (BL-196)', () => {
  const tier = { key: 'tier', operator: 'equals' as const, value: 'gold' };

  it('the conditions travel in the address as JSON and come back the same', () => {
    const search = filtersToSearch({ ...DEFAULT_FILTERS, props: [tier] });
    expect(search).toBe(`?props=${encodeURIComponent(JSON.stringify([tier]))}`);
    expect(parseFilters(params(search)).props).toEqual([tier]);
  });

  it('a malformed or oversized props value is no conditions, never an error', () => {
    for (const raw of [
      'nope',
      '{"a":1}',
      '[{"key":"Bad Key","operator":"equals"}]',
      '[{"key":"x","operator":"drop"}]',
    ])
      expect(parseProps(raw)).toEqual([]);
    const many = JSON.stringify(Array.from({ length: 11 }, () => tier));
    expect(parseProps(many)).toEqual([]);
    expect(parseProps(null)).toEqual([]);
  });

  it('the list and the tiles both send the conditions as one JSON value', () => {
    const f = { ...DEFAULT_FILTERS, props: [tier] };
    expect(listQuery(f).props).toBe(JSON.stringify([tier]));
    expect(statsQuery(f).props).toBe(JSON.stringify([tier]));
  });

  it('a condition narrows the list, so an empty result reads "no match"', () => {
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, props: [tier] })).toBe(true);
  });

  it('an order by a property carries its key and direction, and only then', () => {
    const q = listQuery({ ...DEFAULT_FILTERS, sort: 'property', sortKey: 'tier', sortDir: 'desc' });
    expect(q).toMatchObject({ sort: 'property', sortKey: 'tier', sortDir: 'desc' });
    expect(parseFilters(params('sort=property&sortKey=Bad%20Key')).sort).toBe('created');
    expect(parseFilters(params('sort=property')).sort).toBe('created');
    expect(parseFilters(params('sort=name&sortKey=tier&dir=sideways'))).toMatchObject({
      sort: 'name',
      sortKey: '',
      sortDir: '',
    });
  });

  it('the order select speaks created, name and property:<key>', () => {
    expect(sortValue({ sort: 'property', sortKey: 'tier' })).toBe('property:tier');
    expect(sortValue({ sort: 'name', sortKey: '' })).toBe('name');
    expect(sortFromValue('property:tier')).toEqual({
      sort: 'property',
      sortKey: 'tier',
      sortDir: '',
    });
    expect(sortFromValue('name')).toEqual({ sort: 'name', sortKey: '', sortDir: '' });
    expect(sortFromValue('property:Bad Key').sort).toBe('created');
    expect(sortFromValue('whatever').sort).toBe('created');
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
