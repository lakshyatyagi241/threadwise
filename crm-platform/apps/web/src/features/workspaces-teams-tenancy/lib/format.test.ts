import { describe, expect, it } from 'vitest';
import { joinedDate } from './format';

describe('joinedDate', () => {
  it('formats like WaDesk: short month, day, year', () => {
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
