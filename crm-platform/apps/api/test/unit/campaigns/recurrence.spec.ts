import { describe, expect, it } from 'vitest';
import {
  addDays,
  firstDueFrom,
  occurrenceAt,
  recurrenceDateAt,
  recurrenceRuleSchema,
  upcomingOccurrences,
  weekdayOf,
  zonedTimeToUtc,
  type RecurrenceRuleInput,
} from '@crm/contracts';

const rule = (o: Partial<RecurrenceRuleInput>) =>
  recurrenceRuleSchema.parse({
    frequency: 'daily',
    interval: 1,
    startDate: '2026-10-05',
    timeOfDay: '09:00',
    timezone: 'UTC',
    ...o,
  });
const dates = (r: ReturnType<typeof rule>, n: number) =>
  upcomingOccurrences(r, n).map((o) => o.date);

describe('zonedTimeToUtc', () => {
  it('reads a wall time in its own zone, not the machine zone', () => {
    expect(zonedTimeToUtc('2026-10-05', '09:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-05T03:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-01-15', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-01-15T14:00:00.000Z',
    );
  });

  it('keeps the wall-clock hour across a daylight-saving change', () => {
    // New York springs forward on 2026-03-08 (EST -5 to EDT -4).
    expect(zonedTimeToUtc('2026-03-07', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-03-07T14:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-03-09', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-03-09T13:00:00.000Z',
    );
    // and falls back on 2026-11-01.
    expect(zonedTimeToUtc('2026-10-31', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-10-31T13:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-11-02', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-11-02T14:00:00.000Z',
    );
  });

  it('a time that does not exist (spring-forward gap) lands after the gap, never before it', () => {
    const at = zonedTimeToUtc('2026-03-08', '02:30', 'America/New_York');
    // 02:30 EST would be 07:30Z; EDT begins at 07:00Z, so the first valid instant at or after is 03:30 EDT = 07:30Z.
    expect(at.toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('a time that happens twice (fall-back) is the first of the two', () => {
    // 01:30 on 2026-11-01 in New York is 05:30Z (EDT) and again 06:30Z (EST): the first.
    expect(zonedTimeToUtc('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });
});

describe('calendar helpers', () => {
  it('moves dates by calendar days and finds the weekday', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekdayOf('2026-10-04')).toBe(0); // a Sunday
    expect(weekdayOf('2026-10-10')).toBe(6);
  });
});

describe('daily', () => {
  it('runs every N days from the start date', () => {
    expect(dates(rule({ interval: 1 }), 3)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    expect(dates(rule({ interval: 3 }), 3)).toEqual(['2026-10-05', '2026-10-08', '2026-10-11']);
  });

  it('crosses a month and a year end by the calendar, not by 24-hour blocks', () => {
    expect(dates(rule({ startDate: '2026-12-30', interval: 1 }), 4)).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });
});

describe('weekly', () => {
  it('defaults to the weekday of the start date', () => {
    // 2026-10-05 is a Monday.
    expect(dates(rule({ frequency: 'weekly' }), 3)).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ]);
  });

  it('runs the picked weekdays in date order, skipping the days of the first week before the start', () => {
    // Start Wednesday 2026-10-07; Sunday(0) Wednesday(3) Friday(5): Sunday 10-04 is before the start and is not a run.
    const r = rule({ frequency: 'weekly', startDate: '2026-10-07', weekdays: [5, 0, 3] });
    expect(dates(r, 5)).toEqual([
      '2026-10-07',
      '2026-10-09',
      '2026-10-11',
      '2026-10-14',
      '2026-10-16',
    ]);
  });

  it('every 2 weeks runs the start week, then the week two later', () => {
    const r = rule({ frequency: 'weekly', interval: 2, startDate: '2026-10-05', weekdays: [1, 4] });
    expect(dates(r, 4)).toEqual(['2026-10-05', '2026-10-08', '2026-10-19', '2026-10-22']);
  });
});

describe('monthly', () => {
  it('runs on the same day of each month', () => {
    expect(dates(rule({ frequency: 'monthly', startDate: '2026-10-15' }), 3)).toEqual([
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
    ]);
  });

  it('clamps the 31st to the last day of a shorter month and comes back to the 31st', () => {
    expect(dates(rule({ frequency: 'monthly', startDate: '2026-01-31' }), 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('leap February', () => {
    expect(dates(rule({ frequency: 'monthly', startDate: '2028-01-31' }), 2)).toEqual([
      '2028-01-31',
      '2028-02-29',
    ]);
  });

  it('every 3 months and across the year end', () => {
    expect(dates(rule({ frequency: 'monthly', interval: 3, startDate: '2026-11-30' }), 3)).toEqual([
      '2026-11-30',
      '2027-02-28',
      '2027-05-30',
    ]);
  });

  it('an explicit day of the month wins over the start date, and the first run is not before the start', () => {
    const r = rule({ frequency: 'monthly', startDate: '2026-10-20', monthDay: 10 });
    expect(dates(r, 3)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10']);
  });
});

describe('ends', () => {
  it('never keeps going', () => {
    expect(upcomingOccurrences(rule({}), 50)).toHaveLength(50);
  });

  it('after N stops after exactly N runs', () => {
    const r = rule({ ends: { kind: 'after', occurrences: 3 } });
    expect(dates(r, 10)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    expect(recurrenceDateAt(r, 3)).toBeNull();
  });

  it('on a date includes that date and nothing after it', () => {
    const r = rule({ ends: { kind: 'on_date', date: '2026-10-07' } });
    expect(dates(r, 10)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });

  it('rejects an end date before the start', () => {
    expect(() => rule({ ends: { kind: 'on_date', date: '2026-10-01' } })).toThrow();
  });

  it('weekly after N counts runs, not weeks', () => {
    const r = rule({
      frequency: 'weekly',
      weekdays: [1, 3],
      ends: { kind: 'after', occurrences: 3 },
    });
    expect(dates(r, 10)).toEqual(['2026-10-05', '2026-10-07', '2026-10-12']);
  });
});

describe('occurrenceAt', () => {
  it('turns the date and the wall-clock time into the instant, per the rule zone, on both sides of a DST change', () => {
    const r = rule({
      startDate: '2026-03-07',
      timeOfDay: '09:00',
      timezone: 'America/New_York',
      ends: { kind: 'after', occurrences: 3 },
    });
    expect(upcomingOccurrences(r, 3).map((o) => o.at.toISOString())).toEqual([
      '2026-03-07T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
    ]);
    expect(occurrenceAt(r, 5)).toBeNull();
  });
});

describe('firstDueFrom', () => {
  it('steps over runs a long outage made stale and says how many', () => {
    const r = rule({});
    const out = firstDueFrom(r, 0, new Date('2026-10-08T00:00:00Z'));
    expect(out.skipped).toBe(3);
    expect(out.next?.date).toBe('2026-10-08');
    expect(out.next?.index).toBe(3);
  });

  it('is null once the rule has ended', () => {
    const r = rule({ ends: { kind: 'after', occurrences: 2 } });
    expect(firstDueFrom(r, 0, new Date('2027-01-01T00:00:00Z')).next).toBeNull();
  });
});
