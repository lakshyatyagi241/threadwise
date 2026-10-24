import { describe, expect, it } from 'vitest';
import type { PersonalWorkingHours } from '@crm/contracts';
import {
  effectiveAgentStatus,
  hasOpenDay,
  manualUntil,
  nextScheduleChange,
  readAvailabilityPrefs,
  zonedInstant,
  type ManualChoice,
  type StatusInput,
} from '../../../src/common/agent-status';

type Day = { enabled: boolean; from: string; to: string; extra?: Array<{ from: string; to: string }> };
const off: Day = { enabled: false, from: '09:00', to: '17:00' };
const on = (from = '09:00', to = '17:00', extra?: Day['extra']): Day => ({
  enabled: true,
  from,
  to,
  ...(extra ? { extra } : {}),
});

function hours(
  timezone: string,
  days: Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', Day>>,
  automate = true,
): PersonalWorkingHours {
  return {
    automate,
    timezone,
    days: { mon: off, tue: off, wed: off, thu: off, fri: off, sat: off, sun: off, ...days },
  };
}

/** Mon-Fri 09:00-17:00. */
const weekdays = (tz = 'UTC', automate = true) =>
  hours(tz, { mon: on(), tue: on(), wed: on(), thu: on(), fri: on() }, automate);

const MON_NOON = new Date('2026-06-01T12:00:00Z'); // a Monday, inside 09-17 UTC
const MON_NIGHT = new Date('2026-06-01T22:00:00Z'); // outside

function input(over: Partial<StatusInput>): StatusInput {
  return {
    storedStatus: null,
    manual: null,
    hours: null,
    automationAllowed: true,
    leave: null,
    workspaceTimezone: 'UTC',
    now: MON_NOON,
    ...over,
  };
}

const manualOnline = (setAt: string, until: string | null = null): ManualChoice => ({
  status: 'online',
  setAt,
  until,
});

describe('effectiveAgentStatus: precedence', () => {
  it('a member with no status row is Available', () => {
    const s = effectiveAgentStatus(input({}));
    expect(s).toMatchObject({ state: 'available', reason: 'default', routable: true });
  });

  it('plain stored online without a manual record decides nothing', () => {
    const s = effectiveAgentStatus(input({ storedStatus: 'online', hours: weekdays(), now: MON_NIGHT }));
    expect(s).toMatchObject({ state: 'away', reason: 'schedule', trace: 'outside_working_hours' });
  });

  it('manual Away beats leave, hours and everything', () => {
    for (const leave of [null, { startsOn: '2026-05-01', endsOn: '2026-06-30' }]) {
      for (const now of [MON_NOON, MON_NIGHT]) {
        const s = effectiveAgentStatus(
          input({ storedStatus: 'offline', hours: weekdays(), leave, now }),
        );
        expect(s).toMatchObject({ state: 'away', reason: 'manual', trace: 'away', routable: false });
      }
    }
  });

  it('manual Available beats the schedule', () => {
    const s = effectiveAgentStatus(
      input({
        storedStatus: 'online',
        manual: manualOnline('2026-06-01T21:00:00Z'),
        hours: weekdays(),
        now: MON_NIGHT,
      }),
    );
    expect(s).toMatchObject({ state: 'available', reason: 'manual', routable: true });
  });

  it('manual Available beats a leave it was set during', () => {
    const s = effectiveAgentStatus(
      input({
        storedStatus: 'online',
        manual: manualOnline('2026-06-02T08:00:00Z'),
        leave: { startsOn: '2026-06-01', endsOn: '2026-06-05' },
        now: new Date('2026-06-02T09:00:00Z'),
      }),
    );
    expect(s).toMatchObject({ state: 'available', reason: 'manual' });
  });

  it('manual Available set BEFORE the leave began does not defeat the leave', () => {
    const s = effectiveAgentStatus(
      input({
        storedStatus: 'online',
        manual: manualOnline('2026-05-10T08:00:00Z'),
        leave: { startsOn: '2026-06-01', endsOn: '2026-06-05' },
      }),
    );
    expect(s).toMatchObject({ state: 'away', reason: 'leave', trace: 'on_leave', leaveUntil: '2026-06-05' });
  });

  it('leave beats the schedule, even inside working hours', () => {
    const s = effectiveAgentStatus(
      input({ hours: weekdays(), leave: { startsOn: '2026-06-01', endsOn: null } }),
    );
    expect(s).toMatchObject({ state: 'away', reason: 'leave', leaveUntil: null });
  });

  it('the schedule makes the person Away outside it and Available inside it', () => {
    expect(effectiveAgentStatus(input({ hours: weekdays(), now: MON_NOON }))).toMatchObject({
      state: 'available',
      reason: 'default',
    });
    expect(effectiveAgentStatus(input({ hours: weekdays(), now: MON_NIGHT }))).toMatchObject({
      state: 'away',
      reason: 'schedule',
    });
  });

  it('busy stays not routable and is never turned into anything else', () => {
    const s = effectiveAgentStatus(input({ storedStatus: 'busy', hours: weekdays() }));
    expect(s).toMatchObject({ state: 'away', busy: true, routable: false, trace: 'busy' });
  });
});

describe('effectiveAgentStatus: automation switches', () => {
  it('automation off in the person settings: the schedule is ignored', () => {
    const s = effectiveAgentStatus(input({ hours: weekdays('UTC', false), now: MON_NIGHT }));
    expect(s).toMatchObject({ state: 'available', automationActive: false });
  });

  it('plan flag off: the schedule is ignored, stored data untouched', () => {
    const h = weekdays();
    const s = effectiveAgentStatus(input({ hours: h, automationAllowed: false, now: MON_NIGHT }));
    expect(s).toMatchObject({ state: 'available', automationActive: false });
    expect(h.automate).toBe(true);
  });

  it('empty schedule with automation on is always Available and flagged', () => {
    const empty = hours('UTC', {});
    expect(hasOpenDay(empty)).toBe(false);
    const s = effectiveAgentStatus(input({ hours: empty, now: MON_NIGHT }));
    expect(s).toMatchObject({ state: 'available', emptySchedule: true, automationActive: false });
  });
});

describe('manual choice lasts until the next schedule boundary', () => {
  const until = '2026-06-02T09:00:00.000Z';

  it('Away holds until the boundary, then the schedule decides', () => {
    const base = { storedStatus: 'offline', hours: weekdays(), manual: { status: 'offline', setAt: '2026-06-01T22:00:00Z', until } as ManualChoice };
    const before = effectiveAgentStatus(input({ ...base, now: new Date('2026-06-02T08:59:59Z') }));
    expect(before).toMatchObject({ state: 'away', reason: 'manual', changesAt: new Date(until) });
    const after = effectiveAgentStatus(input({ ...base, now: new Date('2026-06-02T09:00:00Z') }));
    expect(after).toMatchObject({ state: 'available', reason: 'default' });
  });

  it('Away set during working hours expires at the end of the day and the person is then Away by schedule', () => {
    const now = new Date('2026-06-02T17:00:00Z');
    const s = effectiveAgentStatus(
      input({
        storedStatus: 'offline',
        hours: weekdays(),
        manual: { status: 'offline', setAt: '2026-06-02T12:00:00Z', until: '2026-06-02T17:00:00.000Z' },
        now,
      }),
    );
    expect(s).toMatchObject({ state: 'away', reason: 'schedule' });
  });

  it('Available (manual) outside the hours also expires at the next boundary', () => {
    const s = effectiveAgentStatus(
      input({
        storedStatus: 'online',
        hours: weekdays(),
        manual: manualOnline('2026-06-01T22:00:00Z', until),
        now: new Date('2026-06-02T09:00:00Z'),
      }),
    );
    expect(s).toMatchObject({ state: 'available', reason: 'default' });
  });

  it('without automation the manual choice lasts until changed, whatever its stored until', () => {
    const s = effectiveAgentStatus(
      input({
        storedStatus: 'offline',
        hours: weekdays('UTC', false),
        manual: { status: 'offline', setAt: '2026-06-01T22:00:00Z', until },
        now: new Date('2026-06-09T09:00:00Z'),
      }),
    );
    expect(s).toMatchObject({ state: 'away', reason: 'manual', changesAt: null });
  });

  it('plan flag turned off mid-day: automation stops, the manual choice is kept', () => {
    const s = effectiveAgentStatus(
      input({
        storedStatus: 'offline',
        hours: weekdays(),
        automationAllowed: false,
        manual: { status: 'offline', setAt: '2026-06-01T12:00:00Z', until: '2026-06-01T17:00:00.000Z' },
        now: new Date('2026-06-01T20:00:00Z'),
      }),
    );
    expect(s).toMatchObject({ state: 'away', reason: 'manual' });
  });

  it('manualUntil: the next boundary while automating, null otherwise', () => {
    expect(manualUntil(weekdays(), true, MON_NOON)).toBe('2026-06-01T17:00:00.000Z');
    expect(manualUntil(weekdays(), true, MON_NIGHT)).toBe('2026-06-02T09:00:00.000Z');
    expect(manualUntil(weekdays('UTC', false), true, MON_NOON)).toBeNull();
    expect(manualUntil(weekdays(), false, MON_NOON)).toBeNull();
    expect(manualUntil(hours('UTC', {}), true, MON_NOON)).toBeNull();
    expect(manualUntil(null, true, MON_NOON)).toBeNull();
  });
});

describe('schedule rules', () => {
  it('overnight range 22:00 to 06:00 is Available through midnight and until 06:00', () => {
    const night = hours('UTC', { mon: on('22:00', '06:00') });
    const at = (iso: string) =>
      effectiveAgentStatus(input({ hours: night, now: new Date(iso) })).state;
    expect(at('2026-06-01T21:59:00Z')).toBe('away');
    expect(at('2026-06-01T22:00:00Z')).toBe('available');
    expect(at('2026-06-01T23:59:00Z')).toBe('available');
    expect(at('2026-06-02T05:59:00Z')).toBe('available'); // Tuesday small hours, Tuesday is off
    expect(at('2026-06-02T06:00:00Z')).toBe('away');
  });

  it('a range spanning midnight into a day off ends at its own closing time', () => {
    const night = hours('UTC', { fri: on('20:00', '04:00') });
    const next = nextScheduleChange(night, new Date('2026-06-05T21:00:00Z')); // Friday 21:00
    expect(next?.toISOString()).toBe('2026-06-06T04:00:00.000Z'); // Saturday is off
  });

  it('several ranges a day: the lunch gap is a boundary, back-to-back ranges are not', () => {
    const lunch = hours('UTC', { mon: on('09:00', '12:00', [{ from: '13:00', to: '17:00' }]) });
    expect(nextScheduleChange(lunch, new Date('2026-06-01T10:00:00Z'))?.toISOString()).toBe(
      '2026-06-01T12:00:00.000Z',
    );
    const joined = hours('UTC', { mon: on('09:00', '12:00', [{ from: '12:00', to: '17:00' }]) });
    expect(nextScheduleChange(joined, new Date('2026-06-01T10:00:00Z'))?.toISOString()).toBe(
      '2026-06-01T17:00:00.000Z',
    );
  });

  it('a day with "24:00" as closing time runs to the end of the day', () => {
    const all = hours('UTC', { mon: on('00:00', '24:00') });
    expect(nextScheduleChange(all, new Date('2026-06-01T10:00:00Z'))?.toISOString()).toBe(
      '2026-06-02T00:00:00.000Z',
    );
  });

  it('never changes: no open day, or every day all day open', () => {
    expect(nextScheduleChange(hours('UTC', {}), MON_NOON)).toBeNull();
    const always = hours('UTC', {
      mon: on('00:00', '24:00'), tue: on('00:00', '24:00'), wed: on('00:00', '24:00'),
      thu: on('00:00', '24:00'), fri: on('00:00', '24:00'), sat: on('00:00', '24:00'), sun: on('00:00', '24:00'),
    });
    expect(nextScheduleChange(always, MON_NOON)).toBeNull();
  });

  it('daylight saving: spring forward moves the instant, not the local opening time', () => {
    const ny = weekdays('America/New_York');
    // Sunday 8 March 2026 at 12:00 UTC is 08:00 EDT, clocks went forward at 02:00 that day.
    const next = nextScheduleChange(ny, new Date('2026-03-08T12:00:00Z'));
    expect(next?.toISOString()).toBe('2026-03-09T13:00:00.000Z'); // Monday 09:00 EDT
    // The week before it was 09:00 EST = 14:00 UTC.
    expect(nextScheduleChange(ny, new Date('2026-03-01T12:00:00Z'))?.toISOString()).toBe(
      '2026-03-02T14:00:00.000Z',
    );
  });

  it('daylight saving: fall back', () => {
    const ny = weekdays('America/New_York');
    // Sunday 1 November 2026 clocks go back; Monday 09:00 is EST = 14:00 UTC.
    expect(nextScheduleChange(ny, new Date('2026-11-01T15:00:00Z'))?.toISOString()).toBe(
      '2026-11-02T14:00:00.000Z',
    );
  });

  it('a zone change by the person moves the same instant in or out of the hours', () => {
    const at = new Date('2026-06-01T05:00:00Z');
    const kolkata = effectiveAgentStatus(input({ hours: weekdays('Asia/Kolkata'), now: at })); // 10:30 IST
    const newYork = effectiveAgentStatus(input({ hours: weekdays('America/New_York'), now: at })); // 01:00 EDT
    expect(kolkata.state).toBe('available');
    expect(newYork.state).toBe('away');
  });

  it('zonedInstant handles a wall time that does not exist (skipped hour) and the 24:00 end of day', () => {
    expect(zonedInstant('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T06:30:00.000Z', // read with the offset in force before the change: 01:30 EST on the clock
    );
    expect(zonedInstant('2026-06-01', '24:00', 'UTC').toISOString()).toBe('2026-06-02T00:00:00.000Z');
  });
});

describe('readAvailabilityPrefs', () => {
  it('reads a valid record and ignores other keys', () => {
    const r = readAvailabilityPrefs({
      theme: 'dark',
      availability: {
        manual: { status: 'offline', setAt: '2026-06-01T10:00:00Z', until: null },
        hours: weekdays('UTC'),
      },
    });
    expect(r.manual).toEqual({ status: 'offline', setAt: '2026-06-01T10:00:00Z', until: null });
    expect(r.hours?.timezone).toBe('UTC');
  });

  it('malformed or missing data reads as not set', () => {
    expect(readAvailabilityPrefs(null)).toEqual({ manual: null, hours: null });
    expect(readAvailabilityPrefs({ availability: 'x' })).toEqual({ manual: null, hours: null });
    const bad = readAvailabilityPrefs({
      availability: { manual: { status: 'busy', setAt: 'nope' }, hours: { automate: true } },
    });
    expect(bad).toEqual({ manual: null, hours: null });
  });
});
