import { describe, expect, it } from 'vitest';
import {
  addBusinessMinutes,
  dueAt,
  effectiveTargets,
  slaStatus,
} from '../../../src/common/sla-time';

const week = (from: string, to: string, days = ['mon', 'tue', 'wed', 'thu', 'fri']) => ({
  days: Object.fromEntries(days.map((d) => [d, { enabled: true, from, to }])),
});
const iso = (d: Date | null) => d?.toISOString();

describe('effectiveTargets', () => {
  const policy = { firstResponseMinutes: 60, resolutionMinutes: 1440 };

  it('uses the policy targets when the priority has no override', () => {
    expect(effectiveTargets(policy, null, 'normal')).toEqual(policy);
    expect(effectiveTargets(policy, { urgent: { firstResponseMinutes: 5 } }, 'high')).toEqual(
      policy,
    );
  });

  it('an override replaces only the keys it names', () => {
    expect(effectiveTargets(policy, { urgent: { firstResponseMinutes: 5 } }, 'urgent')).toEqual({
      firstResponseMinutes: 5,
      resolutionMinutes: 1440,
    });
    expect(effectiveTargets(policy, { low: { resolutionMinutes: 4320 } }, 'low')).toEqual({
      firstResponseMinutes: 60,
      resolutionMinutes: 4320,
    });
  });

  it('a null or zero target is no clock', () => {
    expect(
      effectiveTargets({ firstResponseMinutes: null, resolutionMinutes: 0 }, null, 'normal'),
    ).toEqual({
      firstResponseMinutes: null,
      resolutionMinutes: null,
    });
  });
});

describe('addBusinessMinutes', () => {
  const hours = week('09:00', '17:00');

  it('is plain addition with no hours configured, or hours with every day off', () => {
    const start = new Date('2026-10-14T10:00:00Z');
    expect(iso(addBusinessMinutes(start, 90, null, 'UTC'))).toBe('2026-10-14T11:30:00.000Z');
    expect(iso(addBusinessMinutes(start, 90, { days: {} }, 'UTC'))).toBe(
      '2026-10-14T11:30:00.000Z',
    );
    expect(iso(addBusinessMinutes(start, 90, { days: { mon: { enabled: false } } }, 'UTC'))).toBe(
      '2026-10-14T11:30:00.000Z',
    );
  });

  it('counts inside one open day', () => {
    // Wednesday 14 October 2026
    expect(iso(addBusinessMinutes(new Date('2026-10-14T10:00:00Z'), 90, hours, 'UTC'))).toBe(
      '2026-10-14T11:30:00.000Z',
    );
  });

  it('stops at closing and carries the rest into the next morning', () => {
    expect(iso(addBusinessMinutes(new Date('2026-10-14T16:30:00Z'), 60, hours, 'UTC'))).toBe(
      '2026-10-15T09:30:00.000Z',
    );
  });

  it('skips the weekend', () => {
    // Friday 16 October 16:00 plus two hours is Monday 19 October 10:00
    expect(iso(addBusinessMinutes(new Date('2026-10-16T16:00:00Z'), 120, hours, 'UTC'))).toBe(
      '2026-10-19T10:00:00.000Z',
    );
  });

  it('a clock that starts while closed starts at the next opening', () => {
    // Saturday 17 October noon, 30 minutes: Monday 09:30
    expect(iso(addBusinessMinutes(new Date('2026-10-17T12:00:00Z'), 30, hours, 'UTC'))).toBe(
      '2026-10-19T09:30:00.000Z',
    );
    // Wednesday 03:00 before opening: 09:15
    expect(iso(addBusinessMinutes(new Date('2026-10-14T03:00:00Z'), 15, hours, 'UTC'))).toBe(
      '2026-10-14T09:15:00.000Z',
    );
  });

  it('a whole working day target lands on the next day at the same hour', () => {
    // 8 hours = 480 minutes from Wednesday 09:00 ends exactly at closing time
    expect(iso(addBusinessMinutes(new Date('2026-10-14T09:00:00Z'), 480, hours, 'UTC'))).toBe(
      '2026-10-14T17:00:00.000Z',
    );
    expect(iso(addBusinessMinutes(new Date('2026-10-14T09:00:00Z'), 540, hours, 'UTC'))).toBe(
      '2026-10-15T10:00:00.000Z',
    );
  });

  it('reads the hours in the workspace time zone', () => {
    // 09:00-17:00 in Kolkata (UTC+5:30). Monday 12 October 10:00Z is 15:30 there, so 90 minutes remain today (until 11:30Z);
    // a 120 minute target carries the other 30 into Tuesday after 09:00 IST (03:30Z): 04:00Z.
    expect(
      iso(addBusinessMinutes(new Date('2026-10-12T10:00:00Z'), 120, hours, 'Asia/Kolkata')),
    ).toBe('2026-10-13T04:00:00.000Z');
  });

  it('follows daylight saving: New York falls back on 1 November 2026', () => {
    // Friday 30 October 16:00 EDT (20:00Z) + 120 min: 60 left on Friday, 60 on Monday after 09:00 EST (14:00Z)
    expect(
      iso(addBusinessMinutes(new Date('2026-10-30T20:00:00Z'), 120, hours, 'America/New_York')),
    ).toBe('2026-11-02T15:00:00.000Z');
  });

  it('an overnight shift counts through midnight', () => {
    const night = { days: { wed: { enabled: true, from: '22:00', to: '06:00' } } };
    // Wednesday 14 October 23:00 + 120 minutes = Thursday 01:00 (the small hours belong to Wednesday's shift)
    expect(iso(addBusinessMinutes(new Date('2026-10-14T23:00:00Z'), 120, night, 'UTC'))).toBe(
      '2026-10-15T01:00:00.000Z',
    );
  });

  it('keeps the seconds of the start', () => {
    expect(iso(addBusinessMinutes(new Date('2026-10-14T10:00:30Z'), 10, hours, 'UTC'))).toBe(
      '2026-10-14T10:10:30.000Z',
    );
  });

  it('handles a long target (a week of business time) quickly', () => {
    const t0 = Date.now();
    // 5 working days of 8 hours from Monday 09:00 ends Friday 17:00
    expect(iso(addBusinessMinutes(new Date('2026-10-12T09:00:00Z'), 5 * 480, hours, 'UTC'))).toBe(
      '2026-10-16T17:00:00.000Z',
    );
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('dueAt', () => {
  const hours = week('09:00', '17:00');
  const start = new Date('2026-10-16T16:00:00Z');

  it('has no due time without a target', () => {
    expect(dueAt(start, null, true, hours, 'UTC')).toBeNull();
  });
  it('is wall-clock time when business hours are not respected', () => {
    expect(iso(dueAt(start, 120, false, hours, 'UTC'))).toBe('2026-10-16T18:00:00.000Z');
  });
  it('is business time when they are', () => {
    expect(iso(dueAt(start, 120, true, hours, 'UTC'))).toBe('2026-10-19T10:00:00.000Z');
  });
});

describe('slaStatus', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  const base = {
    status: 'open',
    waitingSince: '2026-10-14T11:00:00Z',
    firstResponseDue: '2026-10-14T13:00:00Z',
    resolutionDue: '2026-10-15T11:00:00Z',
    breached: false,
  };

  it('shows the first-response clock while the customer waits', () => {
    expect(slaStatus(base, now)).toEqual({
      state: 'ok',
      kind: 'first_response',
      dueAt: '2026-10-14T13:00:00.000Z',
    });
  });

  it('is at risk within thirty minutes of the due time', () => {
    expect(slaStatus({ ...base, firstResponseDue: '2026-10-14T12:29:00Z' }, now)?.state).toBe(
      'at_risk',
    );
    expect(slaStatus({ ...base, firstResponseDue: '2026-10-14T12:31:00Z' }, now)?.state).toBe('ok');
  });

  it('is breached when flagged, and also when the due time has passed but the sweep has not run yet', () => {
    expect(slaStatus({ ...base, breached: true }, now)?.state).toBe('breached');
    expect(slaStatus({ ...base, firstResponseDue: '2026-10-14T11:59:00Z' }, now)?.state).toBe(
      'breached',
    );
  });

  it('moves to the resolution clock once someone has answered', () => {
    expect(slaStatus({ ...base, waitingSince: null }, now)).toEqual({
      state: 'ok',
      kind: 'resolution',
      dueAt: '2026-10-15T11:00:00.000Z',
    });
  });

  it('shows nothing without a clock, or on a finished conversation unless it was breached', () => {
    expect(
      slaStatus({ ...base, firstResponseDue: null, resolutionDue: null, waitingSince: null }, now),
    ).toBeNull();
    expect(slaStatus({ ...base, status: 'resolved' }, now)).toBeNull();
    expect(slaStatus({ ...base, status: 'resolved', breached: true }, now)?.state).toBe('breached');
    expect(slaStatus({ ...base, status: 'spam' }, now)).toBeNull();
  });
});
