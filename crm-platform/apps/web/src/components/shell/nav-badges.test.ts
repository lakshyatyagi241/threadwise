import { describe, expect, it } from 'vitest';
import { countBadge, groupCount, itemCount } from './nav-badges';

describe('countBadge', () => {
  it('hides at zero, below it, and for a number that is not a count', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined, 0.4]) {
      expect(countBadge(bad), String(bad)).toBeNull();
    }
  });

  it('shows the count up to 99 and caps it at 99+', () => {
    expect(countBadge(1)).toBe('1');
    expect(countBadge(42)).toBe('42');
    expect(countBadge(99)).toBe('99');
    expect(countBadge(100)).toBe('99+');
    expect(countBadge(100_000)).toBe('99+');
    expect(countBadge(7.9)).toBe('7');
  });
});

describe('itemCount and groupCount', () => {
  const inbox = { counter: 'inbox-unread' as const, comingSoon: false, locked: false };
  const plain = { counter: undefined, comingSoon: false, locked: false };

  it('reads the number an entry names, and zero for an entry with no counter or no number yet', () => {
    expect(itemCount(inbox, { 'inbox-unread': 5 })).toBe(5);
    expect(itemCount(inbox, {})).toBe(0);
    expect(itemCount(plain, { 'inbox-unread': 5 })).toBe(0);
    expect(itemCount(inbox, { 'inbox-unread': -3 })).toBe(0);
    expect(itemCount(inbox, { 'inbox-unread': Number.NaN })).toBe(0);
  });

  it('sums the group, ignoring entries that are coming soon or locked', () => {
    const counts = { 'inbox-unread': 4 };
    expect(groupCount([inbox, plain], counts)).toBe(4);
    expect(groupCount([{ ...inbox, locked: true }, plain], counts)).toBe(0);
    expect(groupCount([{ ...inbox, comingSoon: true }], counts)).toBe(0);
    expect(groupCount([], counts)).toBe(0);
  });
});
