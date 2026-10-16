import { describe, expect, it } from 'vitest';
import {
  EMPTY_MEETING,
  isoToZonedLocal,
  meetingRangeProblem,
  toCreateMeeting,
  toUpdateMeeting,
  validateMeeting,
  zonedLocalToIso,
} from './meeting-time';

describe('zonedLocalToIso', () => {
  it('reads the wall clock in the given zone', () => {
    expect(zonedLocalToIso('2026-10-16T14:30', 'Asia/Kolkata')).toBe('2026-10-16T09:00:00.000Z');
    expect(zonedLocalToIso('2026-10-16T14:30', 'UTC')).toBe('2026-10-16T14:30:00.000Z');
    // New York is on daylight time (UTC-4) on this date and on standard time (UTC-5) in January.
    expect(zonedLocalToIso('2026-10-16T14:30', 'America/New_York')).toBe(
      '2026-10-16T18:30:00.000Z',
    );
    expect(zonedLocalToIso('2026-01-16T14:30', 'America/New_York')).toBe(
      '2026-01-16T19:30:00.000Z',
    );
  });

  it('crosses midnight in the right direction', () => {
    expect(zonedLocalToIso('2026-10-16T00:15', 'Asia/Kolkata')).toBe('2026-10-15T18:45:00.000Z');
  });

  it('rejects empty and impossible values', () => {
    expect(zonedLocalToIso('', 'UTC')).toBeNull();
    expect(zonedLocalToIso('2026-02-31T10:00', 'UTC')).toBeNull();
    expect(zonedLocalToIso('2026-10-16T25:00', 'UTC')).toBeNull();
    expect(zonedLocalToIso('not a date', 'UTC')).toBeNull();
  });

  it('uses the browser zone when none is given and falls back on an unknown zone name', () => {
    const local = '2026-10-16T14:30';
    expect(isoToZonedLocal(zonedLocalToIso(local))).toBe(local);
    expect(zonedLocalToIso(local, 'Not/AZone')).toBe(zonedLocalToIso(local));
  });
});

describe('isoToZonedLocal', () => {
  it('prints an instant as the datetime-local value in the zone', () => {
    expect(isoToZonedLocal('2026-10-16T09:00:00.000Z', 'Asia/Kolkata')).toBe('2026-10-16T14:30');
    expect(isoToZonedLocal('2026-10-16T09:00:00.000Z', 'UTC')).toBe('2026-10-16T09:00');
  });

  it('shows midnight as 00, not 24', () => {
    expect(isoToZonedLocal('2026-10-16T00:00:00.000Z', 'UTC')).toBe('2026-10-16T00:00');
  });

  it('round-trips through the zone', () => {
    for (const zone of ['Asia/Kolkata', 'America/New_York', 'Asia/Kathmandu', 'UTC']) {
      const iso = zonedLocalToIso('2026-03-08T09:45', zone);
      expect(isoToZonedLocal(iso, zone), zone).toBe('2026-03-08T09:45');
    }
  });

  it('is empty for nothing or a bad value', () => {
    expect(isoToZonedLocal(null, 'UTC')).toBe('');
    expect(isoToZonedLocal(undefined, 'UTC')).toBe('');
    expect(isoToZonedLocal('nope', 'UTC')).toBe('');
  });
});

describe('meetingRangeProblem', () => {
  it('flags an end before the start only', () => {
    expect(meetingRangeProblem('2026-10-16T10:00', '2026-10-16T09:59')).toBe('endBeforeStart');
    expect(meetingRangeProblem('2026-10-16T10:00', '2026-10-16T10:00')).toBeNull();
    expect(meetingRangeProblem('2026-10-16T10:00', '2026-10-17T08:00')).toBeNull();
    expect(meetingRangeProblem('', '2026-10-16T09:00')).toBeNull();
    expect(meetingRangeProblem('2026-10-16T09:00', '')).toBeNull();
  });
});

describe('validateMeeting', () => {
  it('needs a title and keeps it within 255 characters', () => {
    expect(validateMeeting(EMPTY_MEETING, 'UTC').title).toBe('titleRequired');
    expect(validateMeeting({ ...EMPTY_MEETING, title: '   ' }, 'UTC').title).toBe('titleRequired');
    expect(validateMeeting({ ...EMPTY_MEETING, title: 'x'.repeat(255) }, 'UTC')).toEqual({});
    expect(validateMeeting({ ...EMPTY_MEETING, title: 'x'.repeat(256) }, 'UTC').title).toBe(
      'titleTooLong',
    );
  });

  it('limits the location and the order of the times', () => {
    const base = { ...EMPTY_MEETING, title: 'Demo' };
    expect(validateMeeting({ ...base, location: 'y'.repeat(256) }, 'UTC').location).toBe(
      'locationTooLong',
    );
    expect(
      validateMeeting({ ...base, startsAt: '2026-10-16T10:00', endsAt: '2026-10-16T09:00' }, 'UTC')
        .endsAt,
    ).toBe('endBeforeStart');
    expect(validateMeeting({ ...base, startsAt: '2026-10-16T10:00' }, 'UTC')).toEqual({});
  });

  it('flags a time that is not a real date', () => {
    const base = { ...EMPTY_MEETING, title: 'Demo' };
    expect(validateMeeting({ ...base, startsAt: '2026-02-30T10:00' }, 'UTC').startsAt).toBe(
      'startInvalid',
    );
    expect(validateMeeting({ ...base, endsAt: '2026-02-30T10:00' }, 'UTC').endsAt).toBe(
      'endInvalid',
    );
  });
});

describe('request bodies', () => {
  const v = {
    title: '  Product demo ',
    startsAt: '2026-10-16T14:30',
    endsAt: '2026-10-16T15:30',
    location: ' Room 4 ',
  };

  it('create trims, converts the times and leaves out what is empty', () => {
    expect(toCreateMeeting(v, 'Asia/Kolkata')).toEqual({
      title: 'Product demo',
      startsAt: '2026-10-16T09:00:00.000Z',
      endsAt: '2026-10-16T10:00:00.000Z',
      location: 'Room 4',
    });
    expect(toCreateMeeting({ ...EMPTY_MEETING, title: 'Call' }, 'UTC')).toEqual({ title: 'Call' });
  });

  it('update sends rowVersion and nulls what was cleared', () => {
    expect(toUpdateMeeting({ ...v, startsAt: '', endsAt: '', location: '' }, 7, 'UTC')).toEqual({
      title: 'Product demo',
      startsAt: null,
      endsAt: null,
      location: null,
      rowVersion: 7,
    });
    expect(toUpdateMeeting(v, 3, 'UTC').rowVersion).toBe(3);
  });
});
