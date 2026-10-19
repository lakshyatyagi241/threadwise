import { describe, expect, it } from 'vitest';
import type { CalendarEventRequest } from '../../../src/infra/providers/appointments-booking';
import {
  APPOINTMENT_PROPERTY_ID,
  buildGraphEventBody,
  busyIntervalsOf,
  graphDateTime,
  graphEventStateOf,
  joinUrlOf,
  OWN_EVENT_PROPERTY_ID,
  ownIntervalsOf,
  parseGraphTime,
} from '../../../src/infra/providers/appointments-booking';

/** The pure translation between the calendar port and Microsoft Graph's JSON (BL-035). */
const req = (over: Partial<CalendarEventRequest> = {}): CalendarEventRequest => ({
  orgId: 1,
  appointmentId: '5c1e0000-0000-4000-8000-000000000001',
  calendarId: null,
  title: 'Consultation',
  description: 'A first call',
  location: 'https://meet.example/x',
  startsAt: new Date('2026-10-05T03:30:00.000Z'),
  endsAt: new Date('2026-10-05T04:15:00.000Z'),
  timezone: 'Asia/Kolkata',
  attendeeEmail: 'ana@example.com',
  attendeeName: 'Ana Rao',
  createMeet: false,
  existingEventId: null,
  ...over,
});

describe('graphDateTime / parseGraphTime', () => {
  it('writes UTC wall time without a zone suffix and reads it back as the same instant', () => {
    const t = graphDateTime(new Date('2026-10-05T03:30:00.000Z'));
    expect(t).toEqual({ dateTime: '2026-10-05T03:30:00', timeZone: 'UTC' });
    expect(parseGraphTime(t)?.toISOString()).toBe('2026-10-05T03:30:00.000Z');
  });

  it("reads Graph's seven-digit fractions, an explicit offset, and a missing zone as UTC", () => {
    expect(
      parseGraphTime({ dateTime: '2026-10-05T03:30:00.0000000', timeZone: 'UTC' })?.toISOString(),
    ).toBe('2026-10-05T03:30:00.000Z');
    expect(parseGraphTime({ dateTime: '2026-10-05T09:00:00+05:30' })?.toISOString()).toBe(
      '2026-10-05T03:30:00.000Z',
    );
  });

  it('gives null for anything that is not a time', () => {
    expect(parseGraphTime(undefined)).toBeNull();
    expect(parseGraphTime({ dateTime: 'soon' })).toBeNull();
    expect(parseGraphTime({ dateTime: 12 })).toBeNull();
  });
});

describe('buildGraphEventBody', () => {
  it('an insert carries the idempotency key, the private properties and the guest', () => {
    const body = buildGraphEventBody(req(), 'insert');
    expect(body.subject).toBe('Consultation');
    expect(body.start).toEqual({ dateTime: '2026-10-05T03:30:00', timeZone: 'UTC' });
    expect(body.transactionId).toBe('5c1e0000-0000-4000-8000-000000000001');
    expect(body.attendees).toEqual([
      { emailAddress: { address: 'ana@example.com', name: 'Ana Rao' }, type: 'required' },
    ]);
    expect(body.singleValueExtendedProperties).toEqual([
      { id: OWN_EVENT_PROPERTY_ID, value: '1' },
      { id: APPOINTMENT_PROPERTY_ID, value: '5c1e0000-0000-4000-8000-000000000001' },
    ]);
    expect(body.isOnlineMeeting).toBeUndefined();
  });

  it('asks for a Teams room only on insert, only when wanted', () => {
    expect(buildGraphEventBody(req({ createMeet: true }), 'insert')).toMatchObject({
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
    });
    expect(buildGraphEventBody(req({ createMeet: true }), 'patch').isOnlineMeeting).toBeUndefined();
  });

  it('a patch has no create-only fields, and clears what the booking no longer has', () => {
    const body = buildGraphEventBody(
      req({ description: null, location: '  ', attendeeEmail: null, attendeeName: null }),
      'patch',
    );
    expect(body.transactionId).toBeUndefined();
    expect(body.singleValueExtendedProperties).toBeUndefined();
    expect(body.body.content).toBe('');
    expect(body.location.displayName).toBe('');
    expect(body.attendees).toEqual([]);
  });

  it('an insert with no guest leaves the guest list out', () => {
    expect(buildGraphEventBody(req({ attendeeEmail: null }), 'insert').attendees).toBeUndefined();
  });
});

describe('busyIntervalsOf', () => {
  const item = (start: string, end: string, extra: Record<string, unknown> = {}) => ({
    start: { dateTime: start, timeZone: 'UTC' },
    end: { dateTime: end, timeZone: 'UTC' },
    showAs: 'busy',
    ...extra,
  });

  it('keeps busy, tentative and out-of-office time, and drops free, working-elsewhere and cancelled', () => {
    const busy = busyIntervalsOf([
      item('2026-10-05T09:00:00', '2026-10-05T10:00:00'),
      item('2026-10-05T11:00:00', '2026-10-05T12:00:00', { showAs: 'tentative' }),
      item('2026-10-05T13:00:00', '2026-10-05T14:00:00', { showAs: 'oof' }),
      item('2026-10-05T15:00:00', '2026-10-05T16:00:00', { showAs: 'free' }),
      item('2026-10-05T17:00:00', '2026-10-05T18:00:00', { showAs: 'workingElsewhere' }),
      item('2026-10-05T19:00:00', '2026-10-05T20:00:00', { isCancelled: true }),
    ]);
    expect(busy.map((b) => b.start.toISOString())).toEqual([
      '2026-10-05T09:00:00.000Z',
      '2026-10-05T11:00:00.000Z',
      '2026-10-05T13:00:00.000Z',
    ]);
  });

  it('joins overlapping and touching blocks, and ignores an item with no usable time', () => {
    const busy = busyIntervalsOf([
      item('2026-10-05T09:00:00', '2026-10-05T10:00:00'),
      item('2026-10-05T09:30:00', '2026-10-05T11:00:00'),
      item('2026-10-05T11:00:00', '2026-10-05T11:30:00'),
      item('2026-10-05T12:00:00', '2026-10-05T12:00:00'),
      { showAs: 'busy' },
    ]);
    expect(busy).toHaveLength(1);
    expect(busy[0]!.end.toISOString()).toBe('2026-10-05T11:30:00.000Z');
  });
});

describe('ownIntervalsOf', () => {
  it('finds the events that carry our private property, whatever the letter case of its id', () => {
    const mine = {
      start: { dateTime: '2026-10-05T09:00:00' },
      end: { dateTime: '2026-10-05T09:30:00' },
      singleValueExtendedProperties: [{ id: OWN_EVENT_PROPERTY_ID.toLowerCase(), value: '1' }],
    };
    const theirs = {
      start: { dateTime: '2026-10-05T10:00:00' },
      end: { dateTime: '2026-10-05T10:30:00' },
      singleValueExtendedProperties: [{ id: 'String {other} Name x', value: '1' }],
    };
    expect(ownIntervalsOf([mine, theirs, { start: mine.start, end: mine.end }])).toHaveLength(1);
  });
});

describe('graphEventStateOf / joinUrlOf', () => {
  it('a cancelled meeting is deleted', () => {
    expect(graphEventStateOf({ isCancelled: true })).toEqual({ kind: 'deleted' });
  });

  it('reports time, guests (rooms and the empty left out), the version tag and all-day', () => {
    const state = graphEventStateOf({
      start: { dateTime: '2026-10-05T03:30:00', timeZone: 'UTC' },
      end: { dateTime: '2026-10-05T04:15:00', timeZone: 'UTC' },
      '@odata.etag': 'W/"abc"',
      attendees: [
        { type: 'required', emailAddress: { address: 'Zed@Example.com' } },
        { type: 'required', emailAddress: { address: 'ana@example.com' } },
        { type: 'resource', emailAddress: { address: 'room@example.com' } },
        { type: 'optional', emailAddress: {} },
      ],
    });
    expect(state).toMatchObject({
      kind: 'found',
      allDay: false,
      attendees: ['ana@example.com', 'zed@example.com'],
      etag: 'W/"abc"',
    });
    expect(
      graphEventStateOf({ isAllDay: true, start: { dateTime: '2026-10-05T00:00:00' } }),
    ).toMatchObject({
      allDay: true,
    });
  });

  it('reads the Teams join address', () => {
    expect(joinUrlOf({ onlineMeeting: { joinUrl: 'https://teams.example/j/1' } })).toBe(
      'https://teams.example/j/1',
    );
    expect(joinUrlOf({ onlineMeeting: null })).toBeNull();
    expect(joinUrlOf(undefined)).toBeNull();
  });
});
