import { describe, expect, it } from 'vitest';
import {
  isDue,
  minutesLate,
  nextRun,
  wallParts,
  type Recurrence,
} from '../../../src/modules/scheduled-queue-warmer/schedule-time';

const KOLKATA = 'Asia/Kolkata';
const rec = (over: Partial<Recurrence>): Recurrence => ({
  repeatInterval: 'daily',
  repeatEvery: 1,
  daysOfWeek: [],
  endDate: null,
  timezone: KOLKATA,
  ...over,
});
// 09:00 in Kolkata is 03:30 UTC
const at = (iso: string) => new Date(iso);

describe('wall time in the schedule zone', () => {
  it('reads date, time and weekday where the user is', () => {
    expect(wallParts(at('2026-10-05T03:30:00Z'), KOLKATA)).toEqual({
      date: '2026-10-05',
      time: '09:00',
      weekday: 1,
    });
    expect(wallParts(at('2026-10-05T20:00:00Z'), KOLKATA).date).toBe('2026-10-06'); // already tomorrow in India
  });
});

describe('daily (TW-NODE-032)', () => {
  it('every day keeps the wall time', () => {
    expect(nextRun(at('2026-10-05T03:30:00Z'), rec({}))).toEqual(at('2026-10-06T03:30:00Z'));
  });
  it('honours repeat_every, which the bridge ignored; zero or blank means 1', () => {
    expect(nextRun(at('2026-10-05T03:30:00Z'), rec({ repeatEvery: 3 }))).toEqual(
      at('2026-10-08T03:30:00Z'),
    );
    expect(nextRun(at('2026-10-05T03:30:00Z'), rec({ repeatEvery: 0 }))).toEqual(
      at('2026-10-06T03:30:00Z'),
    );
  });
});

describe('weekly', () => {
  it('Monday and Thursday: from Monday the next is Thursday, from Thursday the next is Monday', () => {
    const r = rec({ repeatInterval: 'weekly', daysOfWeek: [1, 4] });
    expect(nextRun(at('2026-10-05T03:30:00Z'), r)).toEqual(at('2026-10-08T03:30:00Z')); // Mon -> Thu
    expect(nextRun(at('2026-10-08T03:30:00Z'), r)).toEqual(at('2026-10-12T03:30:00Z')); // Thu -> Mon
  });
  it('no weekdays picked: the same weekday, every N weeks', () => {
    expect(
      nextRun(at('2026-10-05T03:30:00Z'), rec({ repeatInterval: 'weekly', repeatEvery: 2 })),
    ).toEqual(at('2026-10-19T03:30:00Z'));
  });
  it('a single weekday that is today comes round in 7 days', () => {
    expect(
      nextRun(at('2026-10-05T03:30:00Z'), rec({ repeatInterval: 'weekly', daysOfWeek: [1] })),
    ).toEqual(at('2026-10-12T03:30:00Z'));
  });
  it('an impossible weekday ends the recurrence instead of looping', () => {
    expect(
      nextRun(at('2026-10-05T03:30:00Z'), rec({ repeatInterval: 'weekly', daysOfWeek: [9] })),
    ).toBeNull();
  });
});

describe('monthly', () => {
  it('adds months without overflow: the 31st lands on the last day of a shorter month', () => {
    const r = rec({ repeatInterval: 'monthly', timezone: 'UTC' });
    expect(nextRun(at('2026-01-31T09:00:00Z'), r)).toEqual(at('2026-02-28T09:00:00Z'));
    expect(nextRun(at('2028-01-31T09:00:00Z'), r)).toEqual(at('2028-02-29T09:00:00Z')); // leap year
    expect(nextRun(at('2026-12-15T09:00:00Z'), r)).toEqual(at('2027-01-15T09:00:00Z'));
  });
  it('every 2 months', () => {
    expect(
      nextRun(at('2026-10-05T03:30:00Z'), rec({ repeatInterval: 'monthly', repeatEvery: 2 })),
    ).toEqual(at('2026-12-05T03:30:00Z'));
  });
});

describe('end date is inclusive (the bridge stopped before it)', () => {
  const r = rec({ endDate: '2026-10-07' });
  it('a run on the end date still happens, the one after does not', () => {
    expect(nextRun(at('2026-10-06T03:30:00Z'), r)).toEqual(at('2026-10-07T03:30:00Z'));
    expect(nextRun(at('2026-10-07T03:30:00Z'), r)).toBeNull();
  });
});

describe('zones and daylight saving', () => {
  it('keeps 09:00 New York wall time across the autumn change', () => {
    const r = rec({ timezone: 'America/New_York' });
    expect(nextRun(at('2026-10-31T13:00:00Z'), r)).toEqual(at('2026-11-01T14:00:00Z')); // Sat 09:00 EDT -> Sun 09:00 EST (clocks went back at 02:00)
    expect(nextRun(at('2026-11-01T14:00:00Z'), r)).toEqual(at('2026-11-02T14:00:00Z')); // stays 09:00 EST
  });
});

describe('unknown interval', () => {
  it('ends the recurrence (Reference registered it as a 500)', () => {
    expect(nextRun(at('2026-10-05T03:30:00Z'), rec({ repeatInterval: 'yearly' }))).toBeNull();
    expect(nextRun(at('2026-10-05T03:30:00Z'), rec({ repeatInterval: null }))).toBeNull();
  });
});

describe('due rule and lateness', () => {
  const now = at('2026-10-05T03:30:00Z');
  it('within 5 seconds or already past is due', () => {
    expect(isDue(at('2026-10-05T03:30:04Z'), now)).toBe(true);
    expect(isDue(at('2026-10-05T03:30:06Z'), now)).toBe(false);
    expect(isDue(at('2026-10-05T01:00:00Z'), now)).toBe(true);
  });
  it('counts whole minutes late, never negative', () => {
    expect(minutesLate(at('2026-10-05T03:00:30Z'), now)).toBe(29);
    expect(minutesLate(at('2026-10-05T03:31:00Z'), now)).toBe(0);
  });
});
