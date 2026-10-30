import { formatClock, secondsLeft } from './countdown';

describe('secondsLeft', () => {
  it('rounds up, so "0:01" shows until the very end', () => {
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 5_000)).toBe(5);
  });

  it('is never negative', () => {
    expect(secondsLeft(10_000, 10_000)).toBe(0);
    expect(secondsLeft(10_000, 99_000)).toBe(0);
  });
});

describe('formatClock', () => {
  it('writes minutes and two-digit seconds', () => {
    expect(formatClock(247)).toBe('4:07');
    expect(formatClock(59)).toBe('0:59');
    expect(formatClock(600)).toBe('10:00');
  });

  it('clamps nonsense to zero', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-5)).toBe('0:00');
  });
});
