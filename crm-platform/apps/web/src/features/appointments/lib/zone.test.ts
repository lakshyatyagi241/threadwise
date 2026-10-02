import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayKeyOf,
  daysInMonth,
  diffDays,
  formatClock,
  offsetLabel,
  parseClock,
  parseDayKey,
  safeZone,
  startOfWeek,
  weekdayOf,
  zoneOffsetMinutes,
  zonedDayRange,
  zonedParts,
  zonedTimeToUtc,
} from './zone';

const NY = 'America/New_York';
const LON = 'Europe/London';

describe('zone offsets', () => {
  it('reads the offset of a zone at an instant, daylight saving included', () => {
    expect(zoneOffsetMinutes('2026-01-15T12:00:00Z', NY)).toBe(-300);
    expect(zoneOffsetMinutes('2026-07-15T12:00:00Z', NY)).toBe(-240);
    expect(zoneOffsetMinutes('2026-07-15T12:00:00Z', 'Asia/Kolkata')).toBe(330);
    expect(zoneOffsetMinutes('2026-07-15T12:00:00Z', 'UTC')).toBe(0);
  });

  it('labels the offset', () => {
    expect(offsetLabel('2026-07-15T12:00:00Z', 'Asia/Kolkata')).toBe('GMT+5:30');
    expect(offsetLabel('2026-07-15T12:00:00Z', NY)).toBe('GMT-4');
    expect(offsetLabel('2026-01-15T12:00:00Z', LON)).toBe('GMT');
  });

  it('reads the clock of an instant in a zone', () => {
    const p = zonedParts('2026-03-08T07:30:00Z', NY);
    expect([p.year, p.month, p.day, p.hour, p.minute, p.weekday]).toEqual([2026, 3, 8, 3, 30, 0]);
    // Midnight is hour 0, never 24.
    expect(zonedParts('2026-01-01T05:00:00Z', NY).hour).toBe(0);
  });

  it('falls back to a valid zone', () => {
    expect(safeZone('Not/AZone', 'Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(safeZone(null, null)).toBe('UTC');
    expect(safeZone('Europe/Paris')).toBe('Europe/Paris');
  });
});

describe('zonedTimeToUtc', () => {
  it('converts an ordinary wall time', () => {
    expect(zonedTimeToUtc('2026-07-15', 9 * 60, NY).toISOString()).toBe('2026-07-15T13:00:00.000Z');
    expect(zonedTimeToUtc('2026-07-15', 9 * 60 + 30, 'Asia/Kolkata').toISOString()).toBe(
      '2026-07-15T04:00:00.000Z',
    );
  });

  it('moves a time the zone skips (spring forward) to just after the gap', () => {
    // New York, 8 March 2026: 02:00 jumps to 03:00, so 02:30 does not exist.
    expect(zonedTimeToUtc('2026-03-08', 2 * 60 + 30, NY).toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-03-08', 3 * 60, NY).toISOString()).toBe('2026-03-08T07:00:00.000Z');
    // London, 29 March 2026: 01:00 jumps to 02:00.
    expect(zonedTimeToUtc('2026-03-29', 60 + 30, LON).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  it('takes the earlier of the two times the zone repeats (fall back)', () => {
    // New York, 1 November 2026: 01:30 happens twice; the first one is still daylight time.
    expect(zonedTimeToUtc('2026-11-01', 60 + 30, NY).toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-11-01', 9 * 60, NY).toISOString()).toBe('2026-11-01T14:00:00.000Z');
  });

  it('round-trips every half hour of the transition days', () => {
    for (const day of ['2026-03-08', '2026-11-01']) {
      for (let m = 0; m < 24 * 60; m += 30) {
        const back = zonedParts(zonedTimeToUtc(day, m, NY), NY);
        const wall = back.hour * 60 + back.minute;
        // A skipped time lands after the gap; every other time reads back as itself.
        if (!(day === '2026-03-08' && m >= 120 && m < 180)) expect(wall).toBe(m);
      }
    }
  });

  it('returns an invalid date for a bad day key', () => {
    expect(Number.isNaN(zonedTimeToUtc('2026-02-31', 0, NY).getTime())).toBe(true);
  });
});

describe('days in a zone', () => {
  it('is 23 hours long when the clocks go forward and 25 when they go back', () => {
    const hours = (day: string) => {
      const { start, end } = zonedDayRange(day, NY);
      return (end.getTime() - start.getTime()) / 3_600_000;
    };
    expect(hours('2026-03-08')).toBe(23);
    expect(hours('2026-11-01')).toBe(25);
    expect(hours('2026-06-01')).toBe(24);
  });

  it('puts an instant on the right calendar day', () => {
    expect(dayKeyOf('2026-03-08T04:59:00Z', NY)).toBe('2026-03-07');
    expect(dayKeyOf('2026-03-08T05:00:00Z', NY)).toBe('2026-03-08');
    expect(dayKeyOf('2026-03-08T23:30:00Z', 'Asia/Tokyo')).toBe('2026-03-09');
  });
});

describe('calendar arithmetic', () => {
  it('adds days and months across boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
  });

  it('knows month lengths, weekdays and distances', () => {
    expect(daysInMonth('2024-02-10')).toBe(29);
    expect(daysInMonth('2026-02-10')).toBe(28);
    expect(weekdayOf('2026-10-02')).toBe(5);
    expect(diffDays('2026-10-02', '2026-10-09')).toBe(7);
    expect(diffDays('2026-10-09', '2026-10-02')).toBe(-7);
  });

  it('finds the start of the week for both conventions', () => {
    expect(startOfWeek('2026-10-02', 1)).toBe('2026-09-28');
    expect(startOfWeek('2026-10-02', 0)).toBe('2026-09-27');
    expect(startOfWeek('2026-10-04', 1)).toBe('2026-09-28');
    expect(startOfWeek('2026-10-04', 0)).toBe('2026-10-04');
    expect(startOfWeek('2026-10-02', 6)).toBe('2026-09-26');
  });

  it('rejects dates that do not exist', () => {
    expect(parseDayKey('2026-02-30')).toBeNull();
    expect(parseDayKey('2026-13-01')).toBeNull();
    expect(parseDayKey('26-1-1')).toBeNull();
    expect(parseDayKey('2026-02-28')).toEqual({ year: 2026, month: 2, day: 28 });
  });
});

describe('clock text', () => {
  it('parses and formats 24-hour times', () => {
    expect(parseClock('09:30')).toBe(570);
    expect(parseClock('9:05')).toBe(545);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('12:60')).toBeNull();
    expect(parseClock('noon')).toBeNull();
    expect(formatClock(570)).toBe('09:30');
    expect(formatClock(0)).toBe('00:00');
  });
});
