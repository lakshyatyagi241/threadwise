import { describe, expect, it } from 'vitest';
import {
  dayLabel,
  engagementRate,
  formatCount,
  initial,
  mixRows,
  relativeTime,
  shorten,
  sharePct,
} from './format';

const NOW = new Date('2026-10-02T12:00:00Z');

describe('relativeTime', () => {
  it('names the biggest whole unit, past and future', () => {
    expect(relativeTime('2026-10-02T09:00:00Z', NOW)).toBe('3 hours ago');
    expect(relativeTime('2026-10-02T11:30:00Z', NOW)).toBe('30 minutes ago');
    expect(relativeTime('2026-10-04T12:00:00Z', NOW)).toBe('in 2 days');
    expect(relativeTime('2026-09-18T12:00:00Z', NOW)).toBe('2 weeks ago');
    expect(relativeTime('2025-10-02T12:00:00Z', NOW)).toBe('last year');
  });

  it('under a minute is now, and a missing or bad time is empty', () => {
    expect(relativeTime('2026-10-02T11:59:40Z', NOW)).toBe('now');
    expect(relativeTime(null, NOW)).toBe('');
    expect(relativeTime('nope', NOW)).toBe('');
  });
});

describe('small formatters', () => {
  it('the avatar letter is the first letter of the name, FB without one', () => {
    expect(initial('  shop one')).toBe('S');
    expect(initial('élan')).toBe('É');
    expect(initial('')).toBe('F');
    expect(initial(null)).toBe('F');
  });

  it('shorten cuts with an ellipsis only when it must', () => {
    expect(shorten('abcdef', 6)).toBe('abcdef');
    expect(shorten('abcdefg', 6)).toBe('abcde…');
  });

  it('a share is a whole percent, 0 of nothing', () => {
    expect(sharePct(1, 3)).toBe(33);
    expect(sharePct(2, 3)).toBe(67);
    expect(sharePct(0, 0)).toBe(0);
  });

  it('the engagement rate needs both numbers and keeps one decimal', () => {
    expect(engagementRate(42, 900)).toBe(4.7);
    expect(engagementRate(0, 900)).toBeNull();
    expect(engagementRate(42, 0)).toBeNull();
    expect(engagementRate(undefined, 5)).toBeNull();
  });

  it('counts have separators and a dash when unknown', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(null)).toBe('—');
    expect(formatCount(undefined)).toBe('—');
    expect(formatCount(0)).toBe('0');
  });

  it('a day becomes a short label and a bad one is returned as it is', () => {
    expect(dayLabel('2026-10-02')).toBe('Oct 2');
    expect(dayLabel('x')).toBe('x');
  });

  it('a mix keeps the fixed order, drops empty rows and shares the whole mix (rows left out still count)', () => {
    expect(mixRows({ photo: 1, text: 2, link: 1 }, ['photo', 'multi_photo', 'link'])).toEqual([
      { key: 'photo', n: 1, pct: 25 },
      { key: 'link', n: 1, pct: 25 },
    ]);
    expect(mixRows({}, ['photo'])).toEqual([]);
  });
});
