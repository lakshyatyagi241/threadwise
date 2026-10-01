import { describe, expect, it } from 'vitest';
import { secondsLeft } from './use-countdown';

describe('secondsLeft', () => {
  it('rounds up so the button re-enables only once the wait is over', () => {
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 500)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 10_000)).toBe(0);
  });
  it('never goes negative', () => {
    expect(secondsLeft(10_000, 99_000)).toBe(0);
  });
});
