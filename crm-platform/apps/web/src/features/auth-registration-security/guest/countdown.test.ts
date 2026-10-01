import { describe, expect, it } from 'vitest';
import { formatClock, secondsLeft, wholeMinutes } from './countdown';

describe('countdown helpers', () => {
  it('rounds the remaining time up and never goes negative', () => {
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 8_000)).toBe(2);
    expect(secondsLeft(10_000, 10_000)).toBe(0);
    expect(secondsLeft(10_000, 99_000)).toBe(0);
  });

  it('formats as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(7)).toBe('0:07');
    expect(formatClock(247)).toBe('4:07');
    expect(formatClock(600)).toBe('10:00');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('turns seconds into whole minutes, at least one (lockout message)', () => {
    expect(wholeMinutes(1)).toBe(1);
    expect(wholeMinutes(60)).toBe(1);
    expect(wholeMinutes(61)).toBe(2);
    expect(wholeMinutes(900)).toBe(15);
    expect(wholeMinutes(0)).toBe(1);
  });
});
