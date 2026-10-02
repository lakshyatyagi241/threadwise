import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatClock,
  formatSlotLabel,
  localDateOf,
  localMonthOf,
  monthBounds,
  offsetMs,
  startOfLocalDay,
  wallToInstant,
  weekdayOf,
} from '../../../src/modules/appointments-booking/tz';

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('offsetMs', () => {
  it('reads the zone offset at an instant, including half-hour zones', () => {
    expect(offsetMs(Date.parse('2026-10-05T00:00:00Z'), 'UTC')).toBe(0);
    expect(offsetMs(Date.parse('2026-10-05T00:00:00Z'), 'Asia/Kolkata')).toBe(5.5 * H);
    expect(offsetMs(Date.parse('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-5 * H);
    expect(offsetMs(Date.parse('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-4 * H);
    expect(offsetMs(Date.parse('2026-10-05T00:00:00Z'), 'Asia/Kathmandu')).toBe(5.75 * H);
  });
});

describe('calendar-date arithmetic', () => {
  it('adds days across month and year ends and leap days', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('weekday: 0 = Sunday', () => {
    expect(weekdayOf('2026-10-04')).toBe(0);
    expect(weekdayOf('2026-10-05')).toBe(1);
    expect(weekdayOf('2026-10-10')).toBe(6);
  });
  it('counts whole days between dates', () => {
    expect(daysBetween('2026-10-01', '2026-10-15')).toBe(14);
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });
});

describe('wallToInstant (D-01)', () => {
  it('a plain wall time is the instant that zone reads as that time', () => {
    expect(iso(wallToInstant('2026-10-05', 9 * 60, 'Asia/Kolkata'))).toBe(
      '2026-10-05T03:30:00.000Z',
    );
    expect(iso(wallToInstant('2026-10-05', 9 * 60, 'UTC'))).toBe('2026-10-05T09:00:00.000Z');
    expect(iso(wallToInstant('2026-01-15', 9 * 60, 'America/New_York'))).toBe(
      '2026-01-15T14:00:00.000Z',
    );
    expect(iso(wallToInstant('2026-07-15', 9 * 60, 'America/New_York'))).toBe(
      '2026-07-15T13:00:00.000Z',
    );
  });

  it('spring forward: a wall time that does not exist shifts forward by the gap (New York, 8 March 2026, 02:30 -> 03:30 EDT)', () => {
    expect(iso(wallToInstant('2026-03-08', 2 * 60 + 30, 'America/New_York'))).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    // 03:30 EDT is the very same instant, so the gap collapses to one reading.
    expect(iso(wallToInstant('2026-03-08', 3 * 60 + 30, 'America/New_York'))).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    // Either side of the gap is unaffected.
    expect(iso(wallToInstant('2026-03-08', 1 * 60 + 30, 'America/New_York'))).toBe(
      '2026-03-08T06:30:00.000Z',
    );
    expect(iso(wallToInstant('2026-03-08', 4 * 60, 'America/New_York'))).toBe(
      '2026-03-08T08:00:00.000Z',
    );
  });

  it('fall back: a repeated wall time takes its first occurrence (New York, 1 November 2026, 01:30 -> EDT)', () => {
    expect(iso(wallToInstant('2026-11-01', 1 * 60 + 30, 'America/New_York'))).toBe(
      '2026-11-01T05:30:00.000Z',
    );
    expect(iso(wallToInstant('2026-11-01', 2 * 60 + 30, 'America/New_York'))).toBe(
      '2026-11-01T07:30:00.000Z',
    );
  });

  it('a 23-hour day and a 25-hour day: midnight to midnight', () => {
    const spring =
      startOfLocalDay('2026-03-09', 'America/New_York') -
      startOfLocalDay('2026-03-08', 'America/New_York');
    const fall =
      startOfLocalDay('2026-11-02', 'America/New_York') -
      startOfLocalDay('2026-11-01', 'America/New_York');
    expect(spring).toBe(23 * H);
    expect(fall).toBe(25 * H);
  });

  it('Europe/London (last Sunday of March / October) and a half-hour DST zone (Lord Howe)', () => {
    expect(iso(wallToInstant('2026-03-29', 1 * 60 + 30, 'Europe/London'))).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    expect(iso(wallToInstant('2026-03-29', 2 * 60, 'Europe/London'))).toBe(
      '2026-03-29T01:00:00.000Z',
    );
    expect(iso(wallToInstant('2026-10-25', 1 * 60 + 30, 'Europe/London'))).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    // Lord Howe shifts by 30 minutes: 5 April 2026 02:00 -> 01:30.
    const before = startOfLocalDay('2026-04-04', 'Australia/Lord_Howe');
    const after = startOfLocalDay('2026-04-06', 'Australia/Lord_Howe');
    expect(after - before).toBe(48 * H + 30 * 60_000);
  });

  it('a zone with no DST never moves', () => {
    expect(iso(wallToInstant('2026-03-08', 2 * 60 + 30, 'Asia/Kolkata'))).toBe(
      '2026-03-07T21:00:00.000Z',
    );
  });
});

describe('labels and local dates', () => {
  it('formats the Reference slot label in the zone', () => {
    expect(formatSlotLabel(Date.parse('2026-10-05T03:30:00Z'), 'Asia/Kolkata')).toBe(
      'Mon 5 Oct · 9:00 AM',
    );
    expect(formatSlotLabel(Date.parse('2026-10-05T18:45:00Z'), 'UTC')).toBe('Mon 5 Oct · 6:45 PM');
    expect(formatClock(Date.parse('2026-10-05T00:05:00Z'), 'UTC')).toBe('12:05 AM');
    expect(formatClock(Date.parse('2026-10-05T12:00:00Z'), 'UTC')).toBe('12:00 PM');
  });
  it('the local date of an instant depends on the zone', () => {
    const t = Date.parse('2026-10-05T20:00:00Z');
    expect(localDateOf(t, 'UTC')).toBe('2026-10-05');
    expect(localDateOf(t, 'Asia/Kolkata')).toBe('2026-10-06');
    expect(localDateOf(t, 'America/Los_Angeles')).toBe('2026-10-05');
  });
  it('month bounds follow the zone (the plan cap month)', () => {
    expect(localMonthOf(Date.parse('2026-10-31T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-11');
    const b = monthBounds('2026-10', 'Asia/Kolkata');
    expect(iso(b.startMs)).toBe('2026-09-30T18:30:00.000Z');
    expect(iso(b.endMs)).toBe('2026-10-31T18:30:00.000Z');
    expect(iso(monthBounds('2026-12', 'UTC').endMs)).toBe('2027-01-01T00:00:00.000Z');
  });
});
