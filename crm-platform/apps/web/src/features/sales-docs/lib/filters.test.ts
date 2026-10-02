import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  countsQuery,
  filtersToSearch,
  hasActiveFilter,
  listQuery,
  parseFilters,
  sharedQuery,
  tabCount,
} from './filters';

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));
const ID = '294dca7c-5806-4548-9035-dcca9befc7b1';

describe('address state', () => {
  it('a plain address is the default view', () => {
    expect(parse('')).toEqual(DEFAULT_FILTERS);
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe('');
  });

  it('round-trips every filter', () => {
    const f = {
      ...DEFAULT_FILTERS,
      tab: 'accepted' as const,
      q: 'website',
      owner: ID,
      contact: ID,
      deal: ID,
      validity: 'week' as const,
      activity: ID,
    };
    expect(parse(filtersToSearch(f).slice(1))).toEqual(f);
  });

  it('falls back to defaults for unknown or malformed values instead of failing', () => {
    const f = parse('tab=nope&validity=tomorrow&contact=../../etc&owner=%3Cscript%3E&activity=a b');
    expect(f.tab).toBe('all');
    expect(f.validity).toBe('');
    expect(f.contact).toBe('');
    expect(f.owner).toBe('');
    expect(f.activity).toBe('');
  });

  it('knows "mine" and trims the search to 100 characters', () => {
    expect(parse('owner=mine').owner).toBe('mine');
    expect(parse(`q=${'x'.repeat(300)}`).q).toHaveLength(100);
  });

  it('leaves the default tab out of the address', () => {
    expect(filtersToSearch({ ...DEFAULT_FILTERS, tab: 'sent' })).toBe('?tab=sent');
    expect(filtersToSearch({ ...DEFAULT_FILTERS, q: '  hi  ' })).toBe('?q=hi');
  });

  it('every tab of the screen is accepted', () => {
    for (const tab of [
      'all',
      'draft',
      'sent',
      'viewed',
      'accepted',
      'declined',
      'expired',
      'converted',
    ]) {
      expect(parse(`tab=${tab}`).tab).toBe(tab);
    }
  });
});

describe('activeness', () => {
  it('the tab does not count as a narrowing filter', () => {
    expect(hasActiveFilter(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, q: ' ' })).toBe(false);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, q: 'a' })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, validity: 'lapsed' })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, owner: 'mine' })).toBe(true);
  });
});

describe('queries', () => {
  const today = '2026-10-02';

  it('the list asks for the tab status, "all" asks for none', () => {
    for (const tab of [
      'draft',
      'sent',
      'viewed',
      'accepted',
      'declined',
      'expired',
      'converted',
    ] as const) {
      expect(listQuery({ ...DEFAULT_FILTERS, tab }, today).status, tab).toBe(tab);
    }
    expect(listQuery(DEFAULT_FILTERS, today).status).toBeUndefined();
  });

  it('counts never carry the tab, so each badge answers for its own tab', () => {
    const q = countsQuery({ ...DEFAULT_FILTERS, tab: 'sent', q: 'x' }, today);
    expect(q).not.toHaveProperty('status');
    expect(q.q).toBe('x');
  });

  it('maps the owner, link and validity filters', () => {
    expect(sharedQuery({ ...DEFAULT_FILTERS, owner: ID }, today).ownerId).toBe(ID);
    expect(sharedQuery({ ...DEFAULT_FILTERS, owner: 'mine' }, today)).toMatchObject({
      mine: true,
      ownerId: undefined,
    });
    expect(sharedQuery({ ...DEFAULT_FILTERS, contact: ID, deal: ID }, today)).toMatchObject({
      contactId: ID,
      dealId: ID,
    });
    expect(sharedQuery({ ...DEFAULT_FILTERS, validity: 'week' }, today)).toMatchObject({
      validFrom: '2026-10-02',
      validTo: '2026-10-09',
    });
    // "date has passed" is a window that ends yesterday
    expect(sharedQuery({ ...DEFAULT_FILTERS, validity: 'lapsed' }, today)).toMatchObject({
      validFrom: undefined,
      validTo: '2026-10-01',
    });
  });
});

describe('tab badges', () => {
  const counts = {
    all: 9,
    draft: 1,
    sent: 2,
    viewed: 1,
    accepted: 2,
    declined: 1,
    expired: 1,
    converted: 1,
  };
  it('reads the count of the tab, or nothing while unknown', () => {
    expect(tabCount('sent', counts)).toBe(2);
    expect(tabCount('all', counts)).toBe(9);
    expect(tabCount('sent', undefined)).toBeUndefined();
  });
});
