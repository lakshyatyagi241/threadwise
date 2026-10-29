import { describe, expect, it } from 'vitest';
import { isPastCloseDate } from '../../../src/modules/crm/deals/deal-rules';

const NOW = new Date('2026-10-27T10:00:00Z');

describe('the expected close date of a deal', () => {
  it('may be today or later', () => {
    expect(isPastCloseDate('2026-10-27', NOW)).toBe(false);
    expect(isPastCloseDate('2026-12-01', NOW)).toBe(false);
  });
  it('may be yesterday in UTC, which is today for a person ahead of UTC', () => {
    expect(isPastCloseDate('2026-10-26', NOW)).toBe(false);
  });
  it('is refused when it is before that', () => {
    expect(isPastCloseDate('2026-10-25', NOW)).toBe(true);
    expect(isPastCloseDate('2025-01-01', NOW)).toBe(true);
  });
  it('says nothing about a value that is not a day', () => {
    expect(isPastCloseDate('soon', NOW)).toBe(false);
  });
});
