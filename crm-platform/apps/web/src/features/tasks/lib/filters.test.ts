import { describe, expect, it } from 'vitest';
import {
  countsQuery,
  DEFAULT_FILTERS,
  filtersToSearch,
  hasActiveFilter,
  listQuery,
  parseFilters,
  sharedQuery,
  tabCount,
  type TaskFilters,
} from './filters';

const ID = '3f1c2b7a-5d4e-4a90-8b21-0c9d7e6f5a43';
const ID2 = '9a8b7c6d-1e2f-4a3b-9c4d-5e6f7a8b9c0d';
const params = (s: string) => new URLSearchParams(s);
const f = (patch: Partial<TaskFilters>): TaskFilters => ({ ...DEFAULT_FILTERS, ...patch });

describe('parseFilters', () => {
  it('reads the defaults from an empty address', () => {
    expect(parseFilters(params(''))).toEqual(DEFAULT_FILTERS);
  });
  it('reads every filter', () => {
    expect(
      parseFilters(
        params(
          `tab=all&status=done&q=call&priority=high&assignee=${ID}&contact=${ID2}&view=board&task=${ID}`,
        ),
      ),
    ).toEqual({
      tab: 'all',
      status: 'done',
      q: 'call',
      priority: 'high',
      assignee: ID,
      team: '',
      contact: ID2,
      deal: '',
      company: '',
      outcome: '',
      view: 'board',
      task: ID,
    });
  });
  it('reads and writes the linked company (the company page’s "View all"), and drops one that is not a uuid', () => {
    expect(parseFilters(params(`tab=all&status=all&company=${ID}`)).company).toBe(ID);
    expect(filtersToSearch({ ...DEFAULT_FILTERS, tab: 'all', company: ID })).toContain(
      `company=${ID}`,
    );
    expect(parseFilters(params('company=acme')).company).toBe('');
  });
  it('reads, writes and queries the outcome filter, and drops one that is not a uuid', () => {
    const f = parseFilters(params(`tab=all&outcome=${ID}`));
    expect(f.outcome).toBe(ID);
    expect(filtersToSearch(f)).toContain(`outcome=${ID}`);
    expect(sharedQuery(f).outcomeId).toBe(ID);
    expect(sharedQuery(DEFAULT_FILTERS).outcomeId).toBeUndefined();
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, outcome: ID })).toBe(true);
    expect(parseFilters(params('outcome=interested')).outcome).toBe('');
  });
  it('falls back instead of failing on unknown or malformed values', () => {
    const p = parseFilters(
      params(
        'tab=nope&status=x&priority=urgent&assignee=bob&contact=1&deal=2&company=3&task=zzz&view=grid',
      ),
    );
    expect(p).toEqual(DEFAULT_FILTERS);
  });
  it('keeps "none" for the unassigned filter and caps the search at 100 characters', () => {
    expect(parseFilters(params('assignee=none')).assignee).toBe('none');
    expect(parseFilters(params(`q=${'a'.repeat(300)}`)).q).toHaveLength(100);
  });
});

describe('filtersToSearch', () => {
  it('leaves defaults out so the plain screen keeps a plain address', () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe('');
  });
  it('round-trips a full state', () => {
    const state = f({
      tab: 'all',
      status: 'all',
      q: 'x',
      priority: 'low',
      assignee: 'none',
      deal: ID,
      view: 'board',
      task: ID2,
    });
    expect(parseFilters(params(filtersToSearch(state).slice(1)))).toEqual(state);
  });
  it('writes the status only on the All tab', () => {
    expect(filtersToSearch(f({ tab: 'mine', status: 'done' }))).toBe('');
    expect(filtersToSearch(f({ tab: 'all', status: 'done' }))).toBe('?tab=all&status=done');
  });
});

describe('hasActiveFilter', () => {
  it('ignores the tab and the view', () => {
    expect(hasActiveFilter(f({ tab: 'overdue', view: 'board' }))).toBe(false);
  });
  it('counts search, priority, assignee and links', () => {
    expect(hasActiveFilter(f({ q: ' a ' }))).toBe(true);
    expect(hasActiveFilter(f({ priority: 'high' }))).toBe(true);
    expect(hasActiveFilter(f({ assignee: 'none' }))).toBe(true);
    expect(hasActiveFilter(f({ contact: ID }))).toBe(true);
    expect(hasActiveFilter(f({ company: ID }))).toBe(true);
    expect(hasActiveFilter(f({ q: '   ' }))).toBe(false);
  });
  it('counts a non-default status only on the All tab', () => {
    expect(hasActiveFilter(f({ tab: 'all', status: 'done' }))).toBe(true);
    expect(hasActiveFilter(f({ tab: 'mine', status: 'done' }))).toBe(false);
  });
});

describe('listQuery', () => {
  it('My tasks is open and mine, and ignores the assignee filter', () => {
    expect(listQuery(f({ tab: 'mine', assignee: ID }))).toMatchObject({
      mine: true,
      status: 'open',
      assigneeId: undefined,
      unassigned: undefined,
    });
  });
  it('All tasks takes the status filter and the assignee', () => {
    expect(listQuery(f({ tab: 'all', status: 'all', assignee: ID }))).toMatchObject({
      status: 'all',
      assigneeId: ID,
    });
    expect(listQuery(f({ tab: 'all', assignee: 'none' }))).toMatchObject({
      unassigned: true,
      assigneeId: undefined,
    });
  });
  it('the bucket tabs are open tasks with the due filter', () => {
    for (const tab of ['overdue', 'today', 'upcoming'] as const) {
      expect(listQuery(f({ tab }))).toMatchObject({ status: 'open', due: tab });
    }
  });
  it('Completed is done tasks, latest first', () => {
    expect(listQuery(f({ tab: 'completed' }))).toMatchObject({ status: 'done', sort: 'completed' });
  });
  it('passes the search, priority and linked records through', () => {
    expect(
      listQuery(
        f({ tab: 'all', q: ' acme ', priority: 'high', contact: ID, deal: ID2, company: ID }),
      ),
    ).toMatchObject({
      q: 'acme',
      priority: 'high',
      contactId: ID,
      dealId: ID2,
      companyId: ID,
    });
  });
});

describe('countsQuery and tabCount', () => {
  it('counts never carry the tab', () => {
    const q = countsQuery(f({ tab: 'overdue', priority: 'low' }));
    expect(q).toMatchObject({ priority: 'low' });
    expect(q).not.toHaveProperty('due');
    expect(q).not.toHaveProperty('status');
  });
  const counts = {
    overdue: 2,
    today: 3,
    upcoming: 4,
    open: 12,
    done: 7,
    mine: { open: 5, overdue: 1 },
  };
  it('picks the right number for each tab', () => {
    expect(tabCount('mine', counts)).toBe(5);
    expect(tabCount('all', counts)).toBe(12);
    expect(tabCount('overdue', counts)).toBe(2);
    expect(tabCount('today', counts)).toBe(3);
    expect(tabCount('upcoming', counts)).toBe(4);
    expect(tabCount('completed', counts)).toBe(7);
  });
  it('is unknown until counts arrive', () => {
    expect(tabCount('all', undefined)).toBeUndefined();
  });
});

describe('team filter', () => {
  it('is read from the address, kept in the link and sent to the list and the counts', () => {
    const f = parseFilters(params(`tab=all&team=${ID}`));
    expect(f.team).toBe(ID);
    expect(filtersToSearch(f)).toContain(`team=${ID}`);
    expect(sharedQuery(f).teamId).toBe(ID);
    expect(listQuery(f).teamId).toBe(ID);
    expect(countsQuery(f).teamId).toBe(ID);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, team: ID })).toBe(true);
    expect(parseFilters(params('team=nope')).team).toBe('');
    expect(sharedQuery(DEFAULT_FILTERS).teamId).toBeUndefined();
  });
});
