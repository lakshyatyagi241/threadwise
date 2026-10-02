import { describe, expect, it } from 'vitest';
import { avatarColor, dayKey, dayLabel, daysAgo, humanSize, initials, listTime } from './time';

const NOW = new Date(2026, 9, 2, 15, 0, 0).getTime();
const local = (d: number, h = 12, m = 0) => new Date(2026, 9, d, h, m).toISOString();

describe('days', () => {
  it('groups by local calendar day', () => {
    expect(dayKey(local(2, 0, 5))).toBe(dayKey(local(2, 23, 55)));
    expect(dayKey(local(2))).not.toBe(dayKey(local(1)));
  });

  it('counts calendar days, not 24 hour blocks', () => {
    expect(daysAgo(local(2, 0, 1), NOW)).toBe(0);
    expect(daysAgo(local(1, 23, 59), NOW)).toBe(1);
    expect(daysAgo(new Date(2026, 8, 25, 12).toISOString(), NOW)).toBe(7);
  });

  it('labels today and yesterday in words and older days as dates', () => {
    expect(dayLabel(local(2), NOW, 'en').toLowerCase()).toBe('today');
    expect(dayLabel(local(1), NOW, 'en').toLowerCase()).toBe('yesterday');
    expect(dayLabel(new Date(2026, 8, 20, 12).toISOString(), NOW, 'en')).toMatch(/20 Sept|Sept 20|Sep 20|20 Sep/);
  });
});

describe('listTime', () => {
  it('says now for the last seconds and minutes ago after that', () => {
    expect(listTime(new Date(NOW - 10_000).toISOString(), NOW, 'en').toLowerCase()).toContain('now');
    expect(listTime(new Date(NOW - 5 * 60_000).toISOString(), NOW, 'en')).toMatch(/5/);
  });

  it('shows the clock for earlier today and a date after a week', () => {
    expect(listTime(local(2, 1, 5), NOW, 'en')).toMatch(/1:05|01:05/);
    expect(listTime(new Date(2026, 8, 1, 12).toISOString(), NOW, 'en')).toMatch(/1|Sep/);
  });

  it('is empty for no date', () => {
    expect(listTime(null, NOW, 'en')).toBe('');
  });
});

describe('small helpers', () => {
  it('formats sizes', () => {
    expect(humanSize(512)).toBe('512 B');
    expect(humanSize(2048)).toBe('2.0 KB');
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('takes initials from the first and last word', () => {
    expect(initials('Asha Verma')).toBe('AV');
    expect(initials('  madonna ')).toBe('M');
    expect(initials('')).toBe('?');
    expect(initials('+91 98765 43210')).toBe('94');
    expect(initials('+918858734844')).toBe('9');
  });

  it('gives the same person the same colour', () => {
    expect(avatarColor('abc')).toBe(avatarColor('abc'));
  });
});
