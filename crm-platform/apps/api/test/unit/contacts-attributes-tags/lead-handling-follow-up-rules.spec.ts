import { describe, expect, it } from 'vitest';
import {
  addMonth,
  dayEndOf,
  followUpState,
  plannedFollowUp,
  snoozedTo,
  updatesWhen,
  zonedInstant,
} from '../../../src/modules/crm/lead-handling/follow-up-rules';

const iso = (d: Date) => d.toISOString();

describe("zonedInstant: the instant a zone's clock reads a day and time", () => {
  it('reads a fixed-offset zone exactly', () => {
    expect(iso(zonedInstant('2026-10-18', '09:00', 'Asia/Kolkata'))).toBe(
      '2026-10-18T03:30:00.000Z',
    );
    expect(iso(zonedInstant('2026-10-18', '23:30', 'Asia/Kolkata'))).toBe(
      '2026-10-18T18:00:00.000Z',
    );
    expect(iso(zonedInstant('2026-10-18', '09:00', 'UTC'))).toBe('2026-10-18T09:00:00.000Z');
  });

  it('follows daylight saving: New York is UTC-4 in October and UTC-5 in January', () => {
    expect(iso(zonedInstant('2026-10-18', '09:00', 'America/New_York'))).toBe(
      '2026-10-18T13:00:00.000Z',
    );
    expect(iso(zonedInstant('2027-01-18', '09:00', 'America/New_York'))).toBe(
      '2027-01-18T14:00:00.000Z',
    );
  });

  it('a time skipped by the spring change lands after the gap, and the morning after it is correct', () => {
    // 2027-03-14: clocks in New York jump from 02:00 to 03:00.
    expect(iso(zonedInstant('2027-03-14', '02:30', 'America/New_York'))).toBe(
      '2027-03-14T07:30:00.000Z',
    );
    expect(iso(zonedInstant('2027-03-14', '09:00', 'America/New_York'))).toBe(
      '2027-03-14T13:00:00.000Z',
    );
  });

  it('a time that happens twice in autumn takes the first', () => {
    // 2026-11-01: clocks in New York go back from 02:00 to 01:00, so 01:30 happens at 05:30Z and 06:30Z.
    expect(iso(zonedInstant('2026-11-01', '01:30', 'America/New_York'))).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });
});

describe('addMonth', () => {
  it('keeps the day of the month, clamped to the last day of a shorter month', () => {
    expect(addMonth('2026-10-18')).toBe('2026-11-18');
    expect(addMonth('2026-01-31')).toBe('2026-02-28');
    expect(addMonth('2028-01-31')).toBe('2028-02-29');
    expect(addMonth('2026-03-31')).toBe('2026-04-30');
    expect(addMonth('2026-12-15')).toBe('2027-01-15');
  });
});

describe('followUpState', () => {
  const now = new Date('2026-10-18T10:00:00Z');
  const dayEnd = new Date('2026-10-19T00:00:00Z');
  it('splits like the task list: none, someday, overdue, today, upcoming', () => {
    expect(followUpState(undefined, now, dayEnd)).toBe('none');
    expect(followUpState(null, now, dayEnd)).toBe('someday');
    expect(followUpState(new Date('2026-10-18T09:59:00Z'), now, dayEnd)).toBe('overdue');
    expect(followUpState(new Date('2026-10-18T10:00:00Z'), now, dayEnd)).toBe('today');
    expect(followUpState(new Date('2026-10-18T23:59:00Z'), now, dayEnd)).toBe('today');
    expect(followUpState(new Date('2026-10-19T00:00:00Z'), now, dayEnd)).toBe('upcoming');
  });
});

describe('updatesWhen: the four toggles and the states they cover', () => {
  const only = (key: 'none' | 'overdue' | 'today' | 'future') => ({
    updateWhen: { none: false, overdue: false, today: false, future: false, [key]: true },
  });
  it('maps each state to its own toggle; someday counts as having no follow-up', () => {
    expect(updatesWhen(only('none') as never, 'none')).toBe(true);
    expect(updatesWhen(only('none') as never, 'someday')).toBe(true);
    expect(updatesWhen(only('none') as never, 'overdue')).toBe(false);
    expect(updatesWhen(only('overdue') as never, 'overdue')).toBe(true);
    expect(updatesWhen(only('today') as never, 'today')).toBe(true);
    expect(updatesWhen(only('future') as never, 'upcoming')).toBe(true);
    expect(updatesWhen(only('future') as never, 'today')).toBe(false);
  });
  it('nothing happens with every toggle off', () => {
    for (const state of ['none', 'someday', 'overdue', 'today', 'upcoming'] as const) {
      expect(
        updatesWhen(
          { updateWhen: { none: false, overdue: false, today: false, future: false } } as never,
          state,
        ),
      ).toBe(false);
    }
  });
});

describe('plannedFollowUp: the default date and alert time', () => {
  const now = new Date('2026-10-18T20:00:00Z'); // 01:30 on the 19th in Kolkata, 16:00 on the 18th in New York
  const plan = (defaultDate: unknown, tz: string, defaultTime = '09:00') =>
    plannedFollowUp({ defaultDate, defaultTime } as never, now, tz);

  it("counts days from the workspace's today, not the server's", () => {
    expect(plan({ kind: 'days', days: 3 }, 'Asia/Kolkata')).toEqual({
      kind: 'date',
      at: new Date('2026-10-22T03:30:00Z'),
    });
    expect(plan({ kind: 'days', days: 3 }, 'America/New_York')).toEqual({
      kind: 'date',
      at: new Date('2026-10-21T13:00:00Z'),
    });
  });

  it('one week, one month and a custom number of days', () => {
    expect(plan({ kind: 'days', days: 7 }, 'UTC')).toEqual({
      kind: 'date',
      at: new Date('2026-10-25T09:00:00Z'),
    });
    expect(plan({ kind: 'month' }, 'UTC')).toEqual({
      kind: 'date',
      at: new Date('2026-11-18T09:00:00Z'),
    });
    expect(plan({ kind: 'days', days: 45 }, 'UTC', '17:45')).toEqual({
      kind: 'date',
      at: new Date('2026-12-02T17:45:00Z'),
    });
  });

  it('someday has no date and none sets nothing', () => {
    expect(plan({ kind: 'someday' }, 'UTC')).toEqual({ kind: 'someday' });
    expect(plan({ kind: 'none' }, 'UTC')).toEqual({ kind: 'none' });
  });

  it('is deterministic within a day, so a redelivered touch writes the same instant', () => {
    const a = plannedFollowUp(
      { defaultDate: { kind: 'days', days: 1 }, defaultTime: '09:00' } as never,
      new Date('2026-10-18T05:00:00Z'),
      'Asia/Kolkata',
    );
    const b = plannedFollowUp(
      { defaultDate: { kind: 'days', days: 1 }, defaultTime: '09:00' } as never,
      new Date('2026-10-18T11:00:00Z'),
      'Asia/Kolkata',
    );
    expect(a).toEqual(b);
  });
});

describe('dayEndOf and snoozedTo', () => {
  it("the end of the workspace's day is the next local midnight", () => {
    expect(iso(dayEndOf(new Date('2026-10-18T20:00:00Z'), 'Asia/Kolkata'))).toBe(
      '2026-10-19T18:30:00.000Z',
    );
    expect(iso(dayEndOf(new Date('2026-10-18T20:00:00Z'), 'UTC'))).toBe('2026-10-19T00:00:00.000Z');
  });
  it("a snooze lands on the preset's day at the default alert time", () => {
    const now = new Date('2026-10-18T10:00:00Z');
    expect(iso(snoozedTo('day', '09:00', now, 'UTC'))).toBe('2026-10-19T09:00:00.000Z');
    expect(iso(snoozedTo('three_days', '09:00', now, 'UTC'))).toBe('2026-10-21T09:00:00.000Z');
    expect(iso(snoozedTo('week', '08:15', now, 'UTC'))).toBe('2026-10-25T08:15:00.000Z');
  });
});
