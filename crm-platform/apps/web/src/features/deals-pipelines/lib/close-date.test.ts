import { describe, expect, it } from 'vitest';
import { isPastCloseDate, todayInput } from './close-date';

const NOW = new Date(2026, 9, 27, 10, 0, 0);

describe('close date of a deal in the form', () => {
  it('the earliest day offered is today', () => {
    expect(todayInput(NOW)).toBe('2026-10-27');
  });
  it('refuses a day before today, accepts today and later', () => {
    expect(isPastCloseDate('2026-10-26', NOW)).toBe(true);
    expect(isPastCloseDate('2026-10-27', NOW)).toBe(false);
    expect(isPastCloseDate('2027-01-01', NOW)).toBe(false);
  });
});
