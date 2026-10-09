import { describe, expect, it } from 'vitest';
import { lastPage, pageItems, parseState, purposeOf, relativeTime, toSearch } from './list-model';

import { translator } from '../test-utils/intl';
import { renderMsg, type Msg } from './msg';

const en = (m: Msg): string => renderMsg(translator('flb'), m);

describe('list state in the address (WD-FLB-001)', () => {
  const params = (s: string) => new URLSearchParams(s);

  it('reads status, category, q and page, with the defaults for anything missing or invalid', () => {
    expect(parseState(params(''))).toEqual({ status: 'all', category: 'all', q: '', page: 1 });
    expect(parseState(params('status=paused&category=welcome&q=hi&page=3'))).toEqual({
      status: 'paused',
      category: 'welcome',
      q: 'hi',
      page: 3,
    });
    expect(parseState(params('status=bogus&page=-4&category='))).toEqual({
      status: 'all',
      category: 'all',
      q: '',
      page: 1,
    });
    expect(parseState(params('page=abc')).page).toBe(1);
  });

  it('writes only what differs from the defaults: the Paused tab is /flows?status=paused', () => {
    expect(toSearch({ status: 'paused' })).toBe('?status=paused');
    expect(toSearch({ status: 'all', category: 'all', q: '', page: 1 })).toBe('');
    expect(toSearch({ status: 'live', category: 'lead', q: 'a b', page: 2 })).toBe(
      '?status=live&category=lead&q=a+b&page=2',
    );
  });
});

describe('pager (WaDesk pagination partial)', () => {
  it('shows every page up to seven', () => {
    expect(pageItems(2, 3)).toEqual([1, 2, 3]);
    expect(pageItems(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('collapses the middle with gaps beyond seven', () => {
    expect(pageItems(1, 20)).toEqual([1, 2, 'gap-b', 20]);
    expect(pageItems(10, 20)).toEqual([1, 'gap-a', 9, 10, 11, 'gap-b', 20]);
    expect(pageItems(20, 20)).toEqual([1, 'gap-a', 19, 20]);
  });

  it('30 flows at 12 per page is 3 pages; an empty list is still page 1', () => {
    expect(lastPage(30)).toBe(3);
    expect(lastPage(0)).toBe(1);
    expect(lastPage(12)).toBe(1);
    expect(lastPage(13)).toBe(2);
  });
});

describe('card copy', () => {
  it('the purpose sentence is chosen by category, with a generic fallback', () => {
    expect(en(purposeOf('welcome'))).toMatch(/new subscribers/);
    expect(purposeOf('cart-recovery')).toEqual(purposeOf('cart'));
    expect(en(purposeOf('Showcase'))).toBe('Automated WhatsApp journey built in the flow editor.');
    expect(en(purposeOf(null))).toBe('Automated WhatsApp journey built in the flow editor.');
  });

  it('relative times read like WaDesk "Edited 5 minutes ago"', () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(en(relativeTime(ago(10_000), now))).toBe('just now');
    expect(en(relativeTime(ago(5 * 60_000), now))).toBe('5 minutes ago');
    expect(en(relativeTime(ago(60_000), now))).toBe('1 minute ago');
    expect(en(relativeTime(ago(3 * 3_600_000), now))).toBe('3 hours ago');
    expect(en(relativeTime(ago(2 * 86_400_000), now))).toBe('2 days ago');
  });
});
