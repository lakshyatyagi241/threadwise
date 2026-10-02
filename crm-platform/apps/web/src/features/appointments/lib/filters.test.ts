import { describe, expect, it } from 'vitest';
import {
  CALENDAR_DEFAULT_STATUSES,
  countsQuery,
  DEFAULT_FILTERS,
  filtersToSearch,
  hasActiveFilter,
  listQuery,
  parseFilters,
  rangeQuery,
} from './filters';

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));

describe('appointment filters in the address', () => {
  it('reads defaults from an empty address', () => {
    expect(parse('')).toEqual(DEFAULT_FILTERS);
  });

  it('reads every filter', () => {
    expect(
      parse('tab=past&view=week&status=no_show&type=t1&q=%20ana%20&day=2026-10-05&appt=a1'),
    ).toEqual({
      tab: 'past',
      view: 'week',
      status: 'no_show',
      type: 't1',
      q: 'ana',
      day: '2026-10-05',
      appt: 'a1',
    });
  });

  it('falls back to the default for anything it does not know', () => {
    expect(parse('tab=future&view=agenda&status=maybe&day=2026-02-31')).toEqual(DEFAULT_FILTERS);
  });

  it('writes only what differs from the defaults', () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe('');
    expect(filtersToSearch({ ...DEFAULT_FILTERS, tab: 'past', q: 'ana' })).toBe('?tab=past&q=ana');
    expect(filtersToSearch({ ...DEFAULT_FILTERS, view: 'month', day: '2026-10-05' })).toBe(
      '?view=month&day=2026-10-05',
    );
  });

  it('round-trips', () => {
    const f = {
      ...DEFAULT_FILTERS,
      tab: 'past' as const,
      view: 'week' as const,
      status: 'completed' as const,
      q: 'a b',
      appt: 'x',
    };
    expect(parse(filtersToSearch(f).slice(1))).toEqual(f);
  });

  it('counts the tab and the view as not being filters', () => {
    expect(hasActiveFilter({ status: '', type: '', q: '' })).toBe(false);
    expect(hasActiveFilter({ status: '', type: '', q: '  ' })).toBe(false);
    expect(hasActiveFilter({ status: 'pending', type: '', q: '' })).toBe(true);
    expect(hasActiveFilter({ status: '', type: 't', q: '' })).toBe(true);
    expect(hasActiveFilter({ status: '', type: '', q: 'x' })).toBe(true);
  });
});

describe('queries', () => {
  it('builds the list query', () => {
    expect(
      listQuery({ ...DEFAULT_FILTERS, tab: 'past', status: 'cancelled', type: 't1', q: ' ana ' }),
    ).toEqual({
      tab: 'past',
      status: 'cancelled',
      typeId: 't1',
      q: 'ana',
    });
    expect(listQuery(DEFAULT_FILTERS)).toEqual({
      tab: 'upcoming',
      status: undefined,
      typeId: undefined,
      q: undefined,
    });
  });

  it('counts follow the search and the type, not the status', () => {
    expect(countsQuery({ ...DEFAULT_FILTERS, status: 'pending', type: 't1', q: 'x' })).toEqual({
      typeId: 't1',
      q: 'x',
    });
  });

  it('asks the calendar for a range, leaving out cancelled bookings unless a status is picked', () => {
    const range = { from: '2026-10-05T00:00:00.000Z', to: '2026-10-12T00:00:00.000Z' };
    expect(rangeQuery(DEFAULT_FILTERS, range).status).toBe(CALENDAR_DEFAULT_STATUSES.join(','));
    expect(CALENDAR_DEFAULT_STATUSES).not.toContain('cancelled');
    expect(rangeQuery({ ...DEFAULT_FILTERS, status: 'cancelled' }, range)).toMatchObject({
      ...range,
      status: 'cancelled',
    });
  });
});
