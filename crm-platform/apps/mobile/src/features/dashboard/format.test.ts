import { ApiError } from '@/lib/api';
import {
  ago,
  bucketLabel,
  followersLabel,
  formatMoney,
  greetingKey,
  humanize,
  isForbidden,
  isPlanLocked,
  longDate,
} from './format';

describe('greetingKey', () => {
  it('reads the hour in the workspace time zone, not the phone zone', () => {
    const instant = new Date('2026-10-10T20:30:00.000Z');
    expect(greetingKey(instant, 'UTC')).toBe('evening');
    expect(greetingKey(instant, 'Asia/Kolkata')).toBe('morning'); // 02:00 the next day
    expect(greetingKey(new Date('2026-10-10T08:00:00.000Z'), 'UTC')).toBe('morning');
    expect(greetingKey(new Date('2026-10-10T13:00:00.000Z'), 'UTC')).toBe('afternoon');
    expect(greetingKey(new Date('2026-10-10T16:59:00.000Z'), 'UTC')).toBe('afternoon');
  });

  it('falls back to the phone clock for a zone it does not know', () => {
    const now = new Date(2026, 9, 10, 9, 0, 0);
    expect(greetingKey(now, 'Not/AZone')).toBe('morning');
  });
});

describe('date labels', () => {
  it('writes the long date in the workspace zone', () => {
    expect(longDate(new Date('2026-10-10T20:30:00.000Z'), 'en', 'Asia/Kolkata')).toBe(
      'Sunday, October 11',
    );
  });

  it('falls back to a plain date for an unknown zone', () => {
    expect(longDate(new Date('2026-10-10T12:00:00.000Z'), 'en', 'Not/AZone')).toContain('2026');
  });

  it('labels an hourly bucket with the hour and a daily one with the day', () => {
    expect(bucketLabel('2026-10-10T09:00:00.000Z', true, 'en', 'UTC')).toBe('09:00');
    expect(bucketLabel('2026-10-10T09:00:00.000Z', false, 'en', 'UTC')).toBe('Oct 10');
  });

  it('keeps the raw time when the zone is unknown', () => {
    expect(bucketLabel('2026-10-10T09:00:00.000Z', true, 'en', 'Not/AZone')).toBe('09:00');
    expect(bucketLabel('2026-10-10T09:00:00.000Z', false, 'en', 'Not/AZone')).toBe('10-10');
  });
});

describe('formatMoney', () => {
  it('groups the amount for the language and currency', () => {
    expect(formatMoney(2500, 'INR', 'en-IN')).toContain('2,500.00');
    expect(formatMoney(2500, 'USD', 'en-US')).toBe('$2,500.00');
  });

  it('falls back to the code and the number for a currency it cannot format', () => {
    expect(formatMoney(12.5, 'not a currency', 'en')).toBe('not a currency 12.50');
  });
});

describe('ago', () => {
  const now = new Date('2026-10-10T12:00:00.000Z');
  it('counts minutes, then hours, then days', () => {
    expect(ago('2026-10-10T11:55:00.000Z', now)).toEqual({ unit: 'minute', count: 5 });
    expect(ago('2026-10-10T09:00:00.000Z', now)).toEqual({ unit: 'hour', count: 3 });
    expect(ago('2026-10-08T12:00:00.000Z', now)).toEqual({ unit: 'day', count: 2 });
  });

  it('never goes negative for a time slightly in the future', () => {
    expect(ago('2026-10-10T12:05:00.000Z', now)).toEqual({ unit: 'minute', count: 0 });
  });
});

describe('small helpers', () => {
  it('shortens followers from a thousand up', () => {
    expect(followersLabel(950)).toBe('950');
    expect(followersLabel(12400)).toBe('12.4k');
  });

  it('turns a trigger code into words', () => {
    expect(humanize('order_paid')).toBe('Order paid');
    expect(humanize('')).toBe('');
  });

  it('recognises a refused role and a plan without the feature', () => {
    expect(isForbidden(new ApiError(403, 'FORBIDDEN', 'no'))).toBe(true);
    expect(isForbidden(new ApiError(500, 'X', 'no'))).toBe(false);
    expect(isForbidden(new Error('x'))).toBe(false);
    expect(isPlanLocked(new ApiError(402, 'PLAN_FEATURE_LOCKED', 'no'))).toBe(true);
    expect(isPlanLocked(new ApiError(402, 'OTHER', 'no'))).toBe(false);
  });
});
