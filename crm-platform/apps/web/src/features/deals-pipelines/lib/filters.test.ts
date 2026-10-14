import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  filterQuery,
  filtersToSearch,
  hasActiveFilter,
  matchesFilters,
  parseFilters,
} from './filters';

const params = (s: string) => new URLSearchParams(s);

describe('deal filters', () => {
  it('reads the address and ignores unknown values', () => {
    const f = parseFilters(
      params('pipeline=p1&q=acme&owner=u1&source=api&view=list&status=won&deal=d9'),
    );
    expect(f).toEqual({
      pipeline: 'p1',
      q: 'acme',
      owner: 'u1',
      source: 'api',
      stage: '',
      status: 'won',
      view: 'list',
      deal: 'd9',
    });
    const bad = parseFilters(params('source=carrier-pigeon&status=maybe&view=cube'));
    expect(bad.source).toBe('');
    expect(bad.status).toBe('');
    expect(bad.view).toBe('board');
  });

  it('keeps the plain board address plain', () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe('');
    expect(filtersToSearch({ ...DEFAULT_FILTERS, q: ' acme ', owner: 'none' })).toBe(
      '?q=acme&owner=none',
    );
  });

  it('round-trips', () => {
    const f = {
      ...DEFAULT_FILTERS,
      pipeline: 'p2',
      q: '100%',
      source: 'order' as const,
      view: 'list' as const,
      status: 'open' as const,
    };
    expect(parseFilters(params(filtersToSearch(f)))).toEqual(f);
  });

  it('only remembers the status filter for the list', () => {
    expect(filtersToSearch({ ...DEFAULT_FILTERS, status: 'won' })).toBe('');
  });

  it('only remembers the stage filter (the CRM dashboard funnel link) for the list, and reads it back', () => {
    expect(filtersToSearch({ ...DEFAULT_FILTERS, stage: 's1' })).toBe('');
    const f = { ...DEFAULT_FILTERS, view: 'list' as const, stage: 's1', status: 'open' as const };
    expect(filtersToSearch(f)).toBe('?status=open&stage=s1&view=list');
    expect(parseFilters(params(filtersToSearch(f)))).toEqual(f);
  });

  it('knows when a filter is active', () => {
    expect(hasActiveFilter(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, q: '  ' })).toBe(false);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, owner: 'none' })).toBe(true);
  });

  it('matches deals the way the server does', () => {
    const deal = {
      title: 'Acme annual',
      owner: { id: 'u1', name: 'Ana' },
      source: 'api' as const,
      status: 'open' as const,
    };
    expect(matchesFilters(deal, { ...DEFAULT_FILTERS, q: 'ACME' })).toBe(true);
    expect(matchesFilters(deal, { ...DEFAULT_FILTERS, q: 'beta' })).toBe(false);
    expect(matchesFilters(deal, { ...DEFAULT_FILTERS, owner: 'u1', source: 'api' })).toBe(true);
    expect(matchesFilters(deal, { ...DEFAULT_FILTERS, owner: 'u2' })).toBe(false);
    expect(matchesFilters(deal, { ...DEFAULT_FILTERS, owner: 'none' })).toBe(false);
    expect(matchesFilters({ ...deal, owner: null }, { ...DEFAULT_FILTERS, owner: 'none' })).toBe(
      true,
    );
    expect(matchesFilters(deal, { ...DEFAULT_FILTERS, status: 'won' })).toBe(false);
  });

  it('sends only what is set to the server', () => {
    expect(filterQuery({ ...DEFAULT_FILTERS, q: ' x ', owner: 'u1' })).toEqual({
      q: 'x',
      ownerId: 'u1',
      unassigned: undefined,
      source: undefined,
    });
    expect(filterQuery({ ...DEFAULT_FILTERS, owner: 'none' })).toMatchObject({
      ownerId: undefined,
      unassigned: 'true',
    });
  });
});
