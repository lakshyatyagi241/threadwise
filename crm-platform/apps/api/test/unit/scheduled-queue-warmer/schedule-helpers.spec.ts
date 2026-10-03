import { describe, expect, it } from 'vitest';
import { cleanNumber } from '../../../src/modules/scheduled-queue-warmer/audience/schedule-audience.service';
import {
  normaliseTime,
  splitRoundRobin,
} from '../../../src/modules/scheduled-queue-warmer/schedule-create.service';

describe('schedule input helpers', () => {
  it('reads 24 and 12 hour times as HH:mm', () => {
    expect(normaliseTime('9:05')).toBe('09:05');
    expect(normaliseTime('14:30')).toBe('14:30');
    expect(normaliseTime('2:30 PM')).toBe('14:30');
    expect(normaliseTime('12:15 AM')).toBe('00:15');
    expect(normaliseTime('12:15pm')).toBe('12:15');
    expect(() => normaliseTime('25:00')).toThrow();
    expect(() => normaliseTime('soon')).toThrow();
  });
  it('keeps a typed number only when it is 8 to 15 digits, with spaces and a plus tolerated (WD-SCHED-004 rule 4)', () => {
    expect(cleanNumber('+91 98765 43210')).toBe('919876543210');
    expect(cleanNumber('(212) 555-0100')).toBe('2125550100');
    expect(cleanNumber('12345')).toBeNull();
    expect(cleanNumber('1234567890123456')).toBeNull();
    expect(cleanNumber('call me')).toBeNull();
  });
  it('deals the audience round robin, so nobody lands on two senders (WD-SCHED-005)', () => {
    expect(splitRoundRobin([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([
      [1, 4, 7],
      [2, 5, 8],
      [3, 6, 9],
    ]);
    expect(splitRoundRobin([1, 2], 3)).toEqual([[1], [2], []]);
    expect(splitRoundRobin([], 2)).toEqual([[], []]);
  });
});
