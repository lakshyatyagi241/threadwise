import { describe, expect, it } from 'vitest';
import { bucketLabel, dayLabel, formatMinor, humanDuration, initialsOf, timeLabel } from './format';

describe('durations (Reference: 45s, 3m 20s, 1h 5m)', () => {
  it('has a dash for none and reads seconds, minutes and hours', () => {
    expect(humanDuration(null, 'en')).toBe('—');
    expect(humanDuration(45, 'en')).toBe('45s');
    expect(humanDuration(200, 'en')).toBe('3m 20s');
    expect(humanDuration(3900, 'en')).toBe('1h 5m');
  });
});

describe('amounts', () => {
  it('formats hundredths of a currency', () => {
    expect(formatMinor(1250, 'USD', 'en')).toBe('$12.50');
    expect(formatMinor(5, 'INR', 'en')).toContain('0.05');
  });

  it('falls back to a plain number for no currency or one Intl does not know', () => {
    expect(formatMinor(1250, null, 'en')).toBe('12.50');
    expect(formatMinor(1250, 'credits', 'en')).toBe('12.50');
    expect(formatMinor(1250, 'ZZZ', 'en')).toMatch(/12\.50/);
  });
});

describe('dates', () => {
  const now = new Date('2026-10-13T10:00:00Z');

  it('says today and yesterday, then the date, in the zone given', () => {
    expect(dayLabel('2026-10-13T01:00:00Z', now, 'en', 'UTC')).toBe('today');
    expect(dayLabel('2026-10-12T23:00:00Z', now, 'en', 'UTC')).toBe('yesterday');
    expect(dayLabel('2026-10-03T12:00:00Z', now, 'en', 'UTC')).toBe('Oct 3');
    // 20:00 UTC on the 12th is already the 13th in Kolkata.
    expect(dayLabel('2026-10-12T20:00:00Z', now, 'en', 'Asia/Kolkata')).toBe('today');
  });

  it('prints the time on a 24 hour clock', () => {
    expect(timeLabel('2026-10-13T14:05:00Z', 'en', 'UTC')).toBe('14:05');
    expect(timeLabel('2026-10-13T14:05:00Z', 'en', 'Asia/Kolkata')).toBe('19:35');
  });

  it('labels the chart buckets', () => {
    expect(bucketLabel('2026-10-13T14:00:00Z', 'hourly', 1, 'en', 'UTC')).toBe('14:00');
    expect(bucketLabel('2026-10-13T00:00:00Z', 'daily', 7, 'en', 'UTC')).toBe('Tue');
    expect(bucketLabel('2026-10-13T00:00:00Z', 'daily', 30, 'en', 'UTC')).toBe('Oct 13');
    expect(bucketLabel('2026-10-12T00:00:00Z', 'weekly', 90, 'en', 'UTC')).toBe('Oct 12');
  });
});

describe('initials', () => {
  it('takes the first letters of the first and last word', () => {
    expect(initialsOf('Asha Mine')).toBe('AM');
    expect(initialsOf('Asha')).toBe('A');
    expect(initialsOf('  ')).toBe('··');
    expect(initialsOf('anna maria lopez')).toBe('AL');
  });
});
