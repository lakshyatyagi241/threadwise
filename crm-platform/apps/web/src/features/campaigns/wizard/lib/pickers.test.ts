import { describe, expect, it } from 'vitest';
import {
  clockLabel,
  dateLabel,
  dialValue,
  formatClock,
  monthGrid,
  parseClock,
  shiftMonth,
} from './pickers';

describe('clock', () => {
  it('reads and writes 24-hour times as a 12-hour clock', () => {
    expect(parseClock('09:58')).toEqual({ hour: 9, minute: 58, pm: false });
    expect(parseClock('00:05')).toEqual({ hour: 12, minute: 5, pm: false });
    expect(parseClock('12:00')).toEqual({ hour: 12, minute: 0, pm: true });
    expect(parseClock('23:30')).toEqual({ hour: 11, minute: 30, pm: true });
    expect(formatClock({ hour: 12, minute: 5, pm: false })).toBe('00:05');
    expect(formatClock({ hour: 12, minute: 0, pm: true })).toBe('12:00');
    expect(formatClock({ hour: 11, minute: 30, pm: true })).toBe('23:30');
    expect(clockLabel('21:07')).toBe('09:07 PM');
    expect(parseClock('nonsense')).toEqual({ hour: 9, minute: 0, pm: false });
  });

  it('turns a click on the dial into a mark, clockwise from the top', () => {
    expect(dialValue(0, -10, 12)).toBe(0);
    expect(dialValue(10, 0, 12)).toBe(3);
    expect(dialValue(0, 10, 12)).toBe(6);
    expect(dialValue(-10, 0, 12)).toBe(9);
    expect(dialValue(0, 10, 60)).toBe(30);
    expect(dialValue(-0.1, -10, 60)).toBe(0);
  });
});

describe('calendar', () => {
  it('lays a month out in whole weeks, Sunday first', () => {
    const weeks = monthGrid(2026, 8); // September 2026 starts on a Tuesday
    expect(weeks[0]![0]!.iso).toBe('2026-08-30');
    expect(weeks[0]![2]!.iso).toBe('2026-09-01');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(30);
  });

  it('formats a date for the field and moves across year ends', () => {
    expect(dateLabel('2026-09-22')).toBe('22/09/2026');
    expect(dateLabel('')).toBe('');
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month0: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month0: 11 });
  });
});
