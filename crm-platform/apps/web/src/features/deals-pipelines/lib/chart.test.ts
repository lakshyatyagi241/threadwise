import { describe, expect, it } from 'vitest';
import { barLength, niceMax, ticks } from './chart';

describe('chart geometry', () => {
  it('rounds an axis maximum up to a friendly number', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(12)).toBe(20);
    expect(niceMax(230)).toBe(250);
    expect(niceMax(1)).toBe(1);
  });

  it('spreads ticks evenly from zero', () => {
    expect(ticks(100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(ticks(1, 1)).toEqual([0, 1]);
  });

  it('never lets a real value disappear', () => {
    expect(barLength(0, 100, 200)).toBe(0);
    expect(barLength(1, 1_000_000, 200)).toBe(2);
    expect(barLength(50, 100, 200)).toBe(100);
    expect(barLength(500, 100, 200)).toBe(200);
    expect(barLength(5, 0, 200)).toBe(0);
  });
});
