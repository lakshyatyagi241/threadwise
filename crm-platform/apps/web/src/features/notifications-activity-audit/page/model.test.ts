import { describe, expect, it } from 'vitest';
import type { NotificationResponse } from '@crm/contracts';
import {
  EMPTY_PAGE_FILTERS,
  groupByDay,
  isPageFiltered,
  parsePageFilters,
  sectionOf,
  toPageSearch,
} from './model';

const parse = (qs: string) => parsePageFilters(new URLSearchParams(qs));
// Wednesday 14 October 2026, 15:00 local.
const NOW = new Date(2026, 9, 14, 15, 0, 0);
const at = (days: number, hour = 9) => new Date(2026, 9, 14 - days, hour, 0, 0);
const row = (id: string, when: Date): NotificationResponse =>
  ({
    id,
    type: 'task_assigned',
    title: id,
    body: null,
    link: null,
    data: null,
    readAt: null,
    createdAt: when.toISOString(),
  }) as NotificationResponse;

describe('the URL', () => {
  it('defaults and round-trips', () => {
    expect(parse('')).toEqual(EMPTY_PAGE_FILTERS);
    expect(toPageSearch(EMPTY_PAGE_FILTERS)).toBe('');
    const f = parse('read=unread&type=new_chat&q=ali');
    expect(f).toEqual({ read: 'unread', type: 'new_chat', q: 'ali' });
    expect(parse(toPageSearch(f))).toEqual(f);
    expect(isPageFiltered(f)).toBe(true);
    expect(isPageFiltered(EMPTY_PAGE_FILTERS)).toBe(false);
  });
  it('ignores a type that is not an identifier and any other read value', () => {
    expect(parse('type=../etc&read=maybe')).toEqual(EMPTY_PAGE_FILTERS);
    expect(parse('type=NEW CHAT').type).toBe('');
  });
});

describe('day sections', () => {
  it('uses the viewer calendar days', () => {
    expect(sectionOf(at(0, 0), NOW)).toBe('today');
    expect(sectionOf(at(0, 14), NOW)).toBe('today');
    expect(sectionOf(at(1, 23), NOW)).toBe('yesterday');
    expect(sectionOf(at(2), NOW)).toBe('thisWeek');
    expect(sectionOf(at(6), NOW)).toBe('thisWeek');
    expect(sectionOf(at(7), NOW)).toBe('older');
    expect(sectionOf(at(90), NOW)).toBe('older');
  });
  it('a moment slightly in the future is today', () => {
    expect(sectionOf(new Date(NOW.getTime() + 60_000), NOW)).toBe('today');
  });
  it('groups in order, leaves empty sections out and keeps the server order inside one', () => {
    const groups = groupByDay(
      [row('a', at(0, 14)), row('b', at(0, 9)), row('c', at(3)), row('d', at(30))],
      NOW,
    );
    expect(groups.map((g) => g.section)).toEqual(['today', 'thisWeek', 'older']);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(groupByDay([], NOW)).toEqual([]);
  });
});
