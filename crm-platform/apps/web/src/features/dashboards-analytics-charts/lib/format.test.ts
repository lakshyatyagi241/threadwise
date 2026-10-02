import { describe, expect, it } from 'vitest';
import {
  barLength,
  compact,
  directionOf,
  greetingKey,
  heatLevel,
  isGood,
  niceMax,
  shares,
  signed,
} from './format';

describe('format helpers', () => {
  it('abbreviates thousands and millions', () => {
    expect(compact(999)).toBe('999');
    expect(compact(1234)).toBe('1.2k');
    expect(compact(1_500_000)).toBe('1.5M');
    expect(compact(0)).toBe('0');
  });

  it('knows which direction is good news; fewer failures are good', () => {
    expect(isGood(5)).toBe(true);
    expect(isGood(-50, true)).toBe(true);
    expect(isGood(10, true)).toBe(false);
    expect(isGood(0)).toBeNull();
    expect(directionOf(-1)).toBe('down');
  });

  it('greets by the hour in the workspace zone', () => {
    const at = new Date('2026-10-14T02:00:00Z');
    expect(greetingKey(at, 'UTC')).toBe('morning');
    expect(greetingKey(at, 'Asia/Kolkata')).toBe('morning');
    expect(greetingKey(at, 'America/Los_Angeles')).toBe('evening');
    expect(greetingKey(new Date('2026-10-14T13:00:00Z'), 'UTC')).toBe('afternoon');
  });

  it('axis maths: round maxima, bars that never vanish', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(43)).toBe(50);
    expect(niceMax(1010)).toBe(2000);
    expect(barLength(0, 10, 100)).toBe(0);
    expect(barLength(1, 10000, 100)).toBe(2);
    expect(barLength(50, 10, 100)).toBe(100);
  });

  it('heat levels are relative to the busiest cell', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(5, 0)).toBe(0);
  });

  it('signs deltas and computes shares', () => {
    expect(signed(5, 'pp')).toBe('+5pp');
    expect(signed(-12.5, '%')).toBe('-12.5%');
    expect(signed(0, '%')).toBe('0%');
    expect(
      shares([
        { key: 'text', count: 6 },
        { key: 'template', count: 3 },
        { key: 'media', count: 1 },
      ]).map((s) => s.pct),
    ).toEqual([60, 30, 10]);
    expect(shares([])).toEqual([]);
  });
});
