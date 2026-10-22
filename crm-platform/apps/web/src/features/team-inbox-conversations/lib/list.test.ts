import { describe, expect, it } from 'vitest';
import { id, summary } from './fixtures';
import {
  DEFAULT_FILTERS,
  EMPTY_COUNTS,
  EMPTY_LIST,
  badgeText,
  compareRows,
  countsQuery,
  filtersKey,
  isFiltered,
  listQuery,
  listReducer,
  matchesFilters,
  narrowsCounts,
  placeRow,
  tabCount,
  windowFilterCount,
  type ListFilters,
  type ListState,
} from './list';

const ME = id(7);
const f = (over: Partial<ListFilters> = {}): ListFilters => ({ ...DEFAULT_FILTERS, ...over });
const assignedTo = (userId: string) => ({
  user: { id: userId, name: 'X' },
  team: null,
  aiAgent: null,
});

describe('matchesFilters', () => {
  it('the default view is the open threads, not resolved, snoozed or spam', () => {
    expect(matchesFilters(summary({ status: 'open' }), f(), ME)).toBe(true);
    expect(matchesFilters(summary({ status: 'snoozed' }), f(), ME)).toBe(false);
    expect(matchesFilters(summary({ status: 'resolved' }), f(), ME)).toBe(false);
    expect(matchesFilters(summary({ status: 'resolved' }), f({ status: 'resolved' }), ME)).toBe(
      true,
    );
    expect(matchesFilters(summary({ status: 'spam' }), f({ status: 'all' }), ME)).toBe(true);
  });

  it('Mine is what is assigned to the caller', () => {
    const mine = summary({ assignment: assignedTo(ME) });
    const theirs = summary({ assignment: assignedTo(id(8)) });
    expect(matchesFilters(mine, f({ tab: 'mine' }), ME)).toBe(true);
    expect(matchesFilters(theirs, f({ tab: 'mine' }), ME)).toBe(false);
    expect(matchesFilters(mine, f({ tab: 'mine' }), null)).toBe(false);
  });

  it('Unassigned has no person', () => {
    expect(matchesFilters(summary(), f({ tab: 'unassigned' }), ME)).toBe(true);
    expect(
      matchesFilters(summary({ assignment: assignedTo(ME) }), f({ tab: 'unassigned' }), ME),
    ).toBe(false);
  });

  it('Unread has unread messages', () => {
    expect(matchesFilters(summary({ unreadCount: 2 }), f({ tab: 'unread' }), ME)).toBe(true);
    expect(matchesFilters(summary({ unreadCount: 0 }), f({ tab: 'unread' }), ME)).toBe(false);
  });

  it('filters by channel and archive', () => {
    const row = summary();
    expect(matchesFilters(row, f({ channelId: row.channel.id }), ME)).toBe(true);
    expect(matchesFilters(row, f({ channelId: id(1234) }), ME)).toBe(false);
    expect(matchesFilters(summary({ archived: true }), f(), ME)).toBe(false);
    expect(matchesFilters(summary({ archived: true }), f({ archived: true }), ME)).toBe(true);
  });

  it('searches name, number and preview without caring about case', () => {
    const row = summary({
      title: 'Asha Verma',
      peerKey: '919876543210',
      preview: 'Need an INVOICE',
    });
    expect(matchesFilters(row, f({ q: 'asha' }), ME)).toBe(true);
    expect(matchesFilters(row, f({ q: '9876' }), ME)).toBe(true);
    expect(matchesFilters(row, f({ q: 'invoice' }), ME)).toBe(true);
    expect(matchesFilters(row, f({ q: 'refund' }), ME)).toBe(false);
  });
});

describe('query and keys', () => {
  it('leaves the default status to the server', () => {
    expect(listQuery(f())).toMatchObject({ tab: 'all', status: undefined, archived: undefined });
    expect(listQuery(f({ status: 'resolved', q: 'x', archived: true }))).toMatchObject({
      status: 'resolved',
      q: 'x',
      archived: true,
    });
  });

  it('has a different key for different filters and knows when something is filtered', () => {
    expect(filtersKey(f())).not.toBe(filtersKey(f({ tab: 'mine' })));
    expect(isFiltered(f())).toBe(false);
    expect(isFiltered(f({ tab: 'mine' }))).toBe(false);
    expect(isFiltered(f({ q: 'a' }))).toBe(true);
  });
});

describe('ordering', () => {
  it('pinned first, then the latest message, then the id', () => {
    const a = summary({ id: id(1), lastMessageAt: '2026-10-02T10:00:00.000Z' });
    const b = summary({ id: id(2), lastMessageAt: '2026-10-02T11:00:00.000Z' });
    const p = summary({ id: id(3), pinned: true, lastMessageAt: '2026-10-01T00:00:00.000Z' });
    expect([a, b, p].sort(compareRows).map((r) => r.id)).toEqual([id(3), id(2), id(1)]);
    const same = [summary({ id: id(1) }), summary({ id: id(2) })].sort(compareRows);
    expect(same.map((r) => r.id)).toEqual([id(2), id(1)]);
  });
});

const loaded = (
  rows = [
    summary({ id: id(1) }),
    summary({ id: id(2), lastMessageAt: '2026-10-02T09:00:00.000Z' }),
  ],
  hasMore = false,
): ListState =>
  listReducer(EMPTY_LIST, {
    type: 'loaded',
    rows,
    cursor: hasMore ? 'c' : null,
    hasMore,
    counts: { ...EMPTY_COUNTS, all: rows.length },
  });

describe('listReducer', () => {
  it('loads the first page and then appends the next without repeating a row', () => {
    const first = loaded([summary({ id: id(1) })], true);
    expect(first.loaded).toBe(true);
    const more = listReducer(first, {
      type: 'more',
      rows: [summary({ id: id(1) }), summary({ id: id(2) })],
      cursor: null,
      hasMore: false,
      counts: { ...EMPTY_COUNTS, all: 2 },
    });
    expect(more.rows.map((r) => r.id)).toEqual([id(1), id(2)]);
    expect(more.hasMore).toBe(false);
  });

  it('moves a row that got a new message to the top', () => {
    const next = listReducer(loaded(), {
      type: 'upsert',
      row: summary({
        id: id(2),
        lastMessageAt: '2026-10-02T12:00:00.000Z',
        rowVersion: 2,
        unreadCount: 1,
      }),
      filters: f(),
      meId: ME,
    });
    expect(next.rows.map((r) => r.id)).toEqual([id(2), id(1)]);
    expect(next.rows[0]!.unreadCount).toBe(1);
  });

  it('adds a brand new conversation in order', () => {
    const next = listReducer(loaded(), {
      type: 'upsert',
      row: summary({ id: id(9), lastMessageAt: '2026-10-02T13:00:00.000Z' }),
      filters: f(),
      meId: ME,
    });
    expect(next.rows[0]!.id).toBe(id(9));
  });

  it('drops a row that no longer belongs to the tab', () => {
    const s = loaded();
    const resolved = listReducer(s, {
      type: 'upsert',
      row: summary({ id: id(1), status: 'resolved', rowVersion: 2 }),
      filters: f(),
      meId: ME,
    });
    expect(resolved.rows.map((r) => r.id)).toEqual([id(2)]);
    const assigned = listReducer(s, {
      type: 'upsert',
      row: summary({ id: id(1), assignment: assignedTo(ME), rowVersion: 2 }),
      filters: f({ tab: 'unassigned' }),
      meId: ME,
    });
    expect(assigned.rows.map((r) => r.id)).toEqual([id(2)]);
  });

  it('ignores an answer older than the row it holds', () => {
    const s = loaded([summary({ id: id(1), rowVersion: 5, preview: 'new' })]);
    const next = listReducer(s, {
      type: 'upsert',
      row: summary({ id: id(1), rowVersion: 4, preview: 'old' }),
      filters: f(),
      meId: ME,
    });
    expect(next.rows[0]!.preview).toBe('new');
  });

  it('does not insert a row older than every loaded one while more pages exist', () => {
    const s = loaded([summary({ id: id(1) })], true);
    const rows = placeRow(s, summary({ id: id(5), lastMessageAt: '2020-01-01T00:00:00.000Z' }));
    expect(rows.map((r) => r.id)).toEqual([id(1)]);
  });

  it('sets unread and counts', () => {
    const s = loaded();
    expect(listReducer(s, { type: 'unread', id: id(1), unread: 4 }).rows[0]!.unreadCount).toBe(4);
    expect(
      listReducer(s, { type: 'counts', counts: { ...EMPTY_COUNTS, mine: 3 } }).counts?.mine,
    ).toBe(3);
  });

  it('keeps the rows when only a later page fails', () => {
    const s = listReducer(loaded([summary()], true), { type: 'moreFailed' });
    expect(s.rows).toHaveLength(1);
    expect(s.moreError).toBe(true);
  });
});

describe('tab counts', () => {
  it('returns the server number, never negative, and null before it arrives', () => {
    expect(tabCount(null, 'all')).toBeNull();
    expect(tabCount({ ...EMPTY_COUNTS, unread: 3 }, 'unread')).toBe(3);
    expect(tabCount({ ...EMPTY_COUNTS, unread: -1 }, 'unread')).toBe(0);
  });

  it('asks for the badges with the filters on screen, but without the tab or the sort', () => {
    const q = countsQuery(f({ tab: 'mine', sort: 'old', statuses: ['snoozed'], q: 'ana' }));
    expect(q).toMatchObject({ statuses: 'snoozed', q: 'ana' });
    expect(q).not.toHaveProperty('tab');
    expect(q).not.toHaveProperty('sort');
    expect(countsQuery(f())).toEqual({ archived: undefined });
  });

  it('the menu badge takes the counts only while no filter narrows them (the tab and the sort do not)', () => {
    expect(narrowsCounts(f({ tab: 'unread' }))).toBe(false);
    expect(narrowsCounts(f({ sort: 'old' }))).toBe(false);
    expect(narrowsCounts(f({ status: 'resolved' }))).toBe(true);
    expect(narrowsCounts(f({ channelIds: ['c1'] }))).toBe(true);
  });

  it('caps the row badge', () => {
    expect(badgeText(5)).toBe('5');
    expect(badgeText(100)).toBe('99+');
  });
});

describe("the Filters window's filters", () => {
  it('statuses replace the single status; resolved also takes closed', () => {
    const both = f({ statuses: ['snoozed', 'resolved'] });
    expect(matchesFilters(summary({ status: 'snoozed' }), both, ME)).toBe(true);
    expect(matchesFilters(summary({ status: 'closed' }), both, ME)).toBe(true);
    expect(matchesFilters(summary({ status: 'open' }), both, ME)).toBe(false);
  });

  it('Conversation, agents and the date range narrow a row', () => {
    const mine = summary({ assignment: assignedTo(ME), unreadCount: 0 });
    expect(matchesFilters(mine, f({ assignment: 'assigned' }), ME)).toBe(true);
    expect(matchesFilters(mine, f({ assignment: 'unassigned' }), ME)).toBe(false);
    expect(matchesFilters(mine, f({ assignment: 'unattended' }), ME)).toBe(false);
    expect(matchesFilters(summary({ unreadCount: 2 }), f({ assignment: 'unattended' }), ME)).toBe(
      true,
    );
    expect(matchesFilters(mine, f({ agentIds: [ME] }), ME)).toBe(true);
    expect(matchesFilters(mine, f({ agentIds: [id(9)] }), ME)).toBe(false);
    const day = summary({ lastMessageAt: '2026-10-10T09:00:00.000Z' });
    expect(matchesFilters(day, f({ from: '2026-10-10', to: '2026-10-10' }), ME)).toBe(true);
    expect(matchesFilters(day, f({ from: '2026-10-11' }), ME)).toBe(false);
    expect(matchesFilters(day, f({ to: '2026-10-09' }), ME)).toBe(false);
  });

  it('sends only what is set, counts what is on, and orders oldest first without pins', () => {
    expect(listQuery(f())).toMatchObject({
      statuses: undefined,
      assignment: undefined,
      sort: undefined,
    });
    expect(
      listQuery(
        f({
          statuses: ['snoozed', 'spam'],
          assignment: 'assigned',
          sort: 'old',
          from: '2026-10-01',
        }),
      ),
    ).toMatchObject({
      statuses: 'snoozed,spam',
      assignment: 'assigned',
      sort: 'old',
      from: '2026-10-01',
    });
    expect(windowFilterCount(f())).toBe(0);
    expect(
      windowFilterCount(f({ status: 'snoozed', sort: 'old', from: '2026-10-01', agentIds: [ME] })),
    ).toBe(4);
    expect(filtersKey(f({ sort: 'old' }))).not.toBe(filtersKey(f()));
    expect(isFiltered(f({ sort: 'old' }))).toBe(true);
    const older = summary({ id: id(1), lastMessageAt: '2026-10-01T00:00:00.000Z', pinned: false });
    const newer = summary({ id: id(2), lastMessageAt: '2026-10-02T00:00:00.000Z', pinned: true });
    expect(compareRows(older, newer, true)).toBeLessThan(0);
    expect(compareRows(older, newer)).toBeGreaterThan(0);
  });
});
