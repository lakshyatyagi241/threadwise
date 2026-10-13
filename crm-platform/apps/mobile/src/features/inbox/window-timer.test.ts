import { formatRemaining, partsOf, remainingOf } from './window-timer';

const NOW = new Date('2026-10-13T10:00:00.000Z');

describe('remainingOf', () => {
  it('is how long is left, and never below zero', () => {
    expect(remainingOf('2026-10-13T11:39:30.000Z', NOW)).toBe(99.5 * 60_000);
    expect(remainingOf('2026-10-13T09:00:00.000Z', NOW)).toBe(0);
  });

  it('is null when there is no deadline, or it is not a date', () => {
    expect(remainingOf(null, NOW)).toBeNull();
    expect(remainingOf('not a date', NOW)).toBeNull();
  });
});

describe('formatRemaining', () => {
  it('reads hours then two-digit minutes, rounding the minutes down', () => {
    expect(formatRemaining(99.5 * 60_000)).toBe('1:39');
    expect(formatRemaining(23 * 3_600_000 + 5 * 60_000)).toBe('23:05');
    expect(formatRemaining(59_000)).toBe('0:00');
    expect(formatRemaining(0)).toBe('0:00');
  });

  it('splits into whole hours and minutes', () => {
    expect(partsOf(5_400_000)).toEqual({ hours: 1, minutes: 30 });
  });
});
