import { describe, expect, it } from 'vitest';
import type { ContactViewResponse } from '@crm/contracts';
import { DEFAULT_FILTERS } from '../api/contacts';
import {
  composeViewFilter,
  filtersOfView,
  pickerViews,
  sameFilters,
  tabViews,
  viewChanged,
  viewColumnsOf,
  viewFilterOf,
  viewIdOf,
  viewRulesOf,
  withView,
} from './views';

const ID = '11111111-1111-4111-8111-111111111111';
const view = (over: Partial<ContactViewResponse>): ContactViewResponse => ({
  id: ID,
  name: 'View',
  filter: {},
  position: 0,
  isShared: false,
  shareMode: 'me',
  accessType: 'can_view',
  sharedWith: [],
  canEdit: true,
  canManage: true,
  createdBy: null,
  isFavorite: false,
  rowVersion: 1,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
  ...over,
});

describe('viewFilterOf / filtersOfView', () => {
  it('round-trips the filters a view remembers and never keeps the page or page size', () => {
    const f = {
      ...DEFAULT_FILTERS,
      q: 'asha',
      lifecycleStage: 'lead',
      consent: 'subscribed' as const,
      sort: 'name',
      order: 'asc' as const,
      page: 4,
      limit: 100 as const,
    };
    const saved = viewFilterOf(f);
    expect(saved).toEqual({
      v: 1,
      params: { q: 'asha', stage: 'lead', consent: 'subscribed', sort: 'name', order: 'asc' },
    });
    const back = filtersOfView(saved);
    expect(back).toMatchObject({
      q: 'asha',
      lifecycleStage: 'lead',
      consent: 'subscribed',
      sort: 'name',
      order: 'asc',
      page: 1,
    });
  });
  it('drops malformed saved values instead of breaking the page', () => {
    const back = filtersOfView({
      params: { stage: 'NOT OK!', group: 'nope', consent: 'x', per: '7', page: '9', rules: '{bad' },
    });
    expect(back).toMatchObject({ lifecycleStage: '', group: '', consent: '', rules: '', page: 1 });
    expect(filtersOfView({ params: 5 }).q).toBe('');
    expect(filtersOfView({}).q).toBe('');
  });
});

describe('sameFilters', () => {
  it('ignores the page and page size', () => {
    const a = { ...DEFAULT_FILTERS, q: 'x' };
    expect(sameFilters(a, { ...a, page: 3, limit: 100 })).toBe(true);
    expect(sameFilters(a, { ...a, q: 'y' })).toBe(false);
  });
});

describe('withView / viewIdOf', () => {
  it('adds, replaces and removes view=', () => {
    expect(withView('', ID)).toBe(`?view=${ID}`);
    expect(withView('?q=a', ID)).toBe(`?q=a&view=${ID}`);
    expect(withView(`?view=${ID}&q=a`, '')).toBe('?q=a');
    expect(withView(`?view=${ID}`, '')).toBe('');
  });
  it('reads only a real id', () => {
    expect(viewIdOf(new URLSearchParams(`view=${ID}`))).toBe(ID);
    expect(viewIdOf(new URLSearchParams('view=1'))).toBe('');
    expect(viewIdOf(new URLSearchParams(''))).toBe('');
  });
});

describe('pickerViews / tabViews', () => {
  const a = view({ id: 'a', name: 'Leads', isFavorite: true, position: 2 });
  const b = view({ id: 'b', name: 'Customers', isShared: true, position: 1 });
  const c = view({ id: 'c', name: 'Archive', isFavorite: true, position: 1 });
  it('filters by text and chip', () => {
    expect(pickerViews([a, b, c], 'LEAD', 'all')).toEqual([a]);
    expect(pickerViews([a, b, c], '', 'pinned')).toEqual([a, c]);
    expect(pickerViews([a, b, c], '', 'shared')).toEqual([b]);
  });
  it('shows pinned views in order, plus the open one when it is not pinned', () => {
    expect(tabViews([a, b, c], '').map((v) => v.id)).toEqual(['c', 'a']);
    expect(tabViews([a, b, c], 'b').map((v) => v.id)).toEqual(['c', 'a', 'b']);
    expect(tabViews([a, b, c], 'a').map((v) => v.id)).toEqual(['c', 'a']);
  });
});

describe('view columns and the editor filter', () => {
  it('keeps columns only when given, and reads them back in order', () => {
    expect(viewColumnsOf(viewFilterOf(DEFAULT_FILTERS))).toBeNull();
    const f = viewFilterOf({ ...DEFAULT_FILTERS, q: 'a' }, ['name', 'phone', 'attr:city']);
    expect(f.columns).toEqual(['name', 'phone', 'attr:city']);
    expect(viewColumnsOf(f)).toEqual(['name', 'phone', 'attr:city']);
    expect(viewColumnsOf({ columns: 'x' })).toBeNull();
    expect(viewColumnsOf({ columns: [1, '', 'email'] })).toEqual(['email']);
  });
  it('composes the editor filter: rules and columns replaced, other parameters kept', () => {
    const base = { v: 1, params: { q: 'asha', rules: '{"old":1}' }, columns: ['name'] };
    expect(composeViewFilter(base, '{"new":1}', ['name', 'email'])).toEqual({
      v: 1,
      params: { q: 'asha', rules: '{"new":1}' },
      columns: ['name', 'email'],
    });
    expect(composeViewFilter(null, '', [])).toEqual({ v: 1, params: {} });
    expect(viewRulesOf(base)).toBe('{"old":1}');
    expect(viewRulesOf({})).toBe('');
  });
  it('flags a change in filters, and in columns only for a view that keeps columns', () => {
    const saved = viewFilterOf({ ...DEFAULT_FILTERS, q: 'a' }, ['name', 'phone']);
    const v = view({ filter: saved });
    const same = { ...DEFAULT_FILTERS, q: 'a' };
    expect(viewChanged(v, same, ['name', 'phone'])).toBe(false);
    expect(viewChanged(v, same, ['name', 'email'])).toBe(true);
    expect(viewChanged(v, { ...same, q: 'b' }, ['name', 'phone'])).toBe(true);
    const noCols = view({ filter: viewFilterOf(same) });
    expect(viewChanged(noCols, same, ['anything'])).toBe(false);
  });
});
