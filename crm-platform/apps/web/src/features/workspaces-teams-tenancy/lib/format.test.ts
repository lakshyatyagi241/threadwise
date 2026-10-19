import { describe, expect, it } from 'vitest';
import { dateTime, joinedDate } from './format';

describe('joinedDate', () => {
  it('formats like Reference: short month, day, year', () => {
    expect(joinedDate('2026-10-02T12:00:00.000Z', 'en', 'UTC')).toBe('Oct 2, 2026');
  });
  it('follows the language', () => {
    expect(joinedDate('2026-10-02T12:00:00.000Z', 'ar', 'UTC')).not.toBe('Oct 2, 2026');
  });
  it('is null for a pending member or an unreadable date', () => {
    expect(joinedDate(null, 'en')).toBeNull();
    expect(joinedDate('not a date', 'en')).toBeNull();
  });
});

describe('dateTime', () => {
  it('shows the moment in the workspace time zone', () => {
    // 2026-10-02 12:00 UTC is 17:30 in Kolkata and 05:00 in Los Angeles.
    expect(dateTime('2026-10-02T12:00:00.000Z', 'en', 'Asia/Kolkata')).toBe('Oct 2, 2026, 5:30 PM');
    expect(dateTime('2026-10-02T12:00:00.000Z', 'en', 'America/Los_Angeles')).toBe(
      'Oct 2, 2026, 5:00 AM',
    );
  });
  it('carries the date across midnight in the zone, not in UTC', () => {
    expect(dateTime('2026-10-02T23:00:00.000Z', 'en', 'Asia/Tokyo')).toBe('Oct 3, 2026, 8:00 AM');
  });
  it('is null for nothing or an unreadable time, and survives an unknown zone', () => {
    expect(dateTime(null, 'en', 'UTC')).toBeNull();
    expect(dateTime('not a date', 'en', 'UTC')).toBeNull();
    expect(dateTime('2026-10-02T12:00:00.000Z', 'en', 'Nowhere/Land')).not.toBeNull();
  });
});
