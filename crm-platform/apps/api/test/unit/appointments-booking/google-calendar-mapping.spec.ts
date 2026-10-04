import { describe, expect, it } from 'vitest';
import type { CalendarEventRequest } from '../../../src/infra/providers/appointments-booking/calendar-sync.port';
import {
  classifyApiError,
  classifyTokenError,
  GoogleCalendarError,
} from '../../../src/infra/providers/appointments-booking/google-calendar.errors';
import {
  buildEventBody,
  eventIdFor,
  mergeIntervals,
  meetUrlOf,
  parseEventIntervals,
  parseFreeBusy,
  withoutOwnEvents,
} from '../../../src/infra/providers/appointments-booking/google-calendar.mapping';

/** The pure half of the Google adapter (WD-APPT-029): the event Google is sent, the busy time read back, and how failures are told apart. */
const UUID = '8f14e45f-ceea-467a-9575-8b2b5d4c1a90';
const req = (over: Partial<CalendarEventRequest> = {}): CalendarEventRequest => ({
  orgId: 1,
  appointmentId: UUID,
  calendarId: null,
  title: 'Site visit',
  description: 'Bring the plans',
  location: '12 MG Road',
  startsAt: new Date('2026-10-12T09:30:00Z'),
  endsAt: new Date('2026-10-12T10:30:00Z'),
  timezone: 'Asia/Kolkata',
  attendeeEmail: 'ana@example.com',
  attendeeName: 'Ana',
  createMeet: false,
  existingEventId: null,
  ...over,
});
const at = (a: string, b: string) => ({ start: new Date(a), end: new Date(b) });

describe('the Google event id', () => {
  it("is the appointment uuid without its dashes, inside Google's base32hex alphabet", () => {
    const id = eventIdFor(UUID);
    expect(id).toBe('8f14e45fceea467a95758b2b5d4c1a90');
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
  });

  it('is stable: the same appointment always maps to the same event (what makes a retried insert a 409, not a second event)', () => {
    expect(eventIdFor(UUID)).toBe(eventIdFor(UUID.toUpperCase()));
  });

  it('refuses an id Google would not accept', () => {
    expect(() => eventIdFor('not a uuid!')).toThrow();
  });
});

describe('the event body', () => {
  it("describes the booking in the booking's own zone and marks it as ours", () => {
    const body = buildEventBody(req(), eventIdFor(UUID), 'insert');
    expect(body).toMatchObject({
      id: eventIdFor(UUID),
      summary: 'Site visit',
      description: 'Bring the plans',
      location: '12 MG Road',
      start: { dateTime: '2026-10-12T09:30:00.000Z', timeZone: 'Asia/Kolkata' },
      end: { dateTime: '2026-10-12T10:30:00.000Z', timeZone: 'Asia/Kolkata' },
      status: 'confirmed',
      reminders: { useDefault: true },
      attendees: [{ email: 'ana@example.com', displayName: 'Ana' }],
      extendedProperties: { private: { crmManaged: '1', crmAppointment: UUID } },
    });
    expect(body.conferenceData).toBeUndefined();
  });

  it('leaves empty fields out of an insert and clears them in a patch', () => {
    const empty = req({ description: null, location: '  ', attendeeEmail: null });
    const insert = buildEventBody(empty, 'x'.repeat(8), 'insert');
    expect(insert.description).toBeUndefined();
    expect(insert.location).toBeUndefined();
    expect(insert.attendees).toBeUndefined();
    const patch = buildEventBody(empty, 'x'.repeat(8), 'patch');
    expect(patch.description).toBeNull();
    expect(patch.location).toBeNull();
    expect(patch.id).toBeUndefined();
  });

  it('asks for one Meet room, with the appointment as the request id (a repeat is ignored by Google)', () => {
    const body = buildEventBody(req({ createMeet: true }), eventIdFor(UUID), 'insert');
    expect(body.conferenceData).toEqual({
      createRequest: { requestId: UUID, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    });
    expect(
      buildEventBody(req({ createMeet: true }), eventIdFor(UUID), 'patch').conferenceData,
    ).toEqual(body.conferenceData);
  });

  it('leaves the attendee name off when there is none', () => {
    const body = buildEventBody(req({ attendeeName: null }), 'abcde', 'insert');
    expect(body.attendees).toEqual([{ email: 'ana@example.com' }]);
  });
});

describe('the Meet address of an event', () => {
  it('reads hangoutLink, else the first video entry point, else nothing', () => {
    expect(meetUrlOf({ hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc' })).toBe(
      'https://meet.google.com/aaa-bbbb-ccc',
    );
    expect(
      meetUrlOf({
        conferenceData: {
          entryPoints: [
            { entryPointType: 'phone', uri: 'tel:+1' },
            { entryPointType: 'video', uri: 'https://meet.google.com/xyz' },
          ],
        },
      }),
    ).toBe('https://meet.google.com/xyz');
    expect(meetUrlOf({})).toBeNull();
    expect(meetUrlOf(null)).toBeNull();
  });
});

describe('free/busy', () => {
  it('reads the busy intervals of the asked calendar, joined and in order', () => {
    const parsed = parseFreeBusy(
      {
        calendars: {
          primary: {
            busy: [
              { start: '2026-10-12T11:00:00Z', end: '2026-10-12T12:00:00Z' },
              { start: '2026-10-12T09:00:00Z', end: '2026-10-12T10:00:00Z' },
              { start: '2026-10-12T09:30:00Z', end: '2026-10-12T10:30:00Z' },
            ],
          },
        },
      },
      'primary',
    );
    expect(parsed.error).toBeNull();
    expect(parsed.busy).toEqual([
      at('2026-10-12T09:00:00Z', '2026-10-12T10:30:00Z'),
      at('2026-10-12T11:00:00Z', '2026-10-12T12:00:00Z'),
    ]);
  });

  it('drops intervals that are not instants or do not run forwards', () => {
    const parsed = parseFreeBusy(
      {
        calendars: {
          c: {
            busy: [
              { start: 'soon', end: '2026-10-12T12:00:00Z' },
              { start: '2026-10-12T12:00:00Z', end: '2026-10-12T12:00:00Z' },
              { start: 1, end: 2 },
              { start: '2026-10-12T13:00:00Z', end: '2026-10-12T14:00:00Z' },
            ],
          },
        },
      },
      'c',
    );
    expect(parsed.busy).toEqual([at('2026-10-12T13:00:00Z', '2026-10-12T14:00:00Z')]);
  });

  it('does not take a calendar Google could not read for a free one', () => {
    expect(
      parseFreeBusy({ calendars: { c: { errors: [{ reason: 'notFound' }], busy: [] } } }, 'c'),
    ).toEqual({ busy: [], error: 'notFound' });
    expect(parseFreeBusy({ calendars: {} }, 'c').error).toBeTruthy();
    expect(parseFreeBusy(null, 'c').error).toBeTruthy();
  });

  it('an answer with no busy time is free time', () => {
    expect(parseFreeBusy({ calendars: { c: { busy: [] } } }, 'c')).toEqual({
      busy: [],
      error: null,
    });
  });

  it('joins overlapping and touching intervals', () => {
    expect(
      mergeIntervals([
        at('2026-10-12T10:00:00Z', '2026-10-12T11:00:00Z'),
        at('2026-10-12T09:00:00Z', '2026-10-12T10:00:00Z'),
        at('2026-10-12T12:00:00Z', '2026-10-12T13:00:00Z'),
      ]),
    ).toEqual([
      at('2026-10-12T09:00:00Z', '2026-10-12T11:00:00Z'),
      at('2026-10-12T12:00:00Z', '2026-10-12T13:00:00Z'),
    ]);
  });
});

describe('our own events in the busy time', () => {
  it('reads the timed events of an events.list answer and skips all-day and cancelled ones', () => {
    expect(
      parseEventIntervals({
        items: [
          {
            start: { dateTime: '2026-10-12T09:00:00Z' },
            end: { dateTime: '2026-10-12T10:00:00Z' },
          },
          { start: { date: '2026-10-13' }, end: { date: '2026-10-14' } },
          {
            status: 'cancelled',
            start: { dateTime: '2026-10-12T11:00:00Z' },
            end: { dateTime: '2026-10-12T12:00:00Z' },
          },
        ],
      }),
    ).toEqual([at('2026-10-12T09:00:00Z', '2026-10-12T10:00:00Z')]);
  });

  it('removes a busy block that is exactly one of ours', () => {
    const busy = [at('2026-10-12T09:00:00Z', '2026-10-12T10:00:00Z')];
    expect(withoutOwnEvents(busy, [at('2026-10-12T09:00:00Z', '2026-10-12T10:00:00Z')])).toEqual(
      [],
    );
  });

  it("keeps a block that is also covered by somebody else's event (it is a different block)", () => {
    const busy = [at('2026-10-12T09:00:00Z', '2026-10-12T11:00:00Z')];
    expect(withoutOwnEvents(busy, [at('2026-10-12T09:00:00Z', '2026-10-12T10:00:00Z')])).toEqual(
      busy,
    );
  });

  it('matches back-to-back events of ours that Google reports as one block', () => {
    const busy = [at('2026-10-12T09:00:00Z', '2026-10-12T10:00:00Z')];
    const own = [
      at('2026-10-12T09:00:00Z', '2026-10-12T09:30:00Z'),
      at('2026-10-12T09:30:00Z', '2026-10-12T10:00:00Z'),
    ];
    expect(withoutOwnEvents(busy, own)).toEqual([]);
  });

  it('changes nothing when there are none of ours', () => {
    const busy = [at('2026-10-12T09:00:00Z', '2026-10-12T10:00:00Z')];
    expect(withoutOwnEvents(busy, [])).toBe(busy);
  });
});

describe("telling Google's failures apart", () => {
  const kind = (status: number, body: unknown) => classifyApiError(status, body).kind;

  it('a refused refresh token is invalid_grant: only a new consent helps', () => {
    const e = classifyTokenError(400, {
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    });
    expect(e.kind).toBe('invalid_grant');
    expect(e.retryable).toBe(false);
    expect(e.reason).toBe('invalid_grant');
  });

  it("a wrong client id or secret is the platform's problem, not the workspace's", () => {
    expect(classifyTokenError(401, { error: 'invalid_client' }).kind).toBe('invalid_client');
    expect(classifyTokenError(400, { error: 'unauthorized_client' }).kind).toBe('invalid_client');
  });

  it('other token failures are retried when Google is at fault and not when the request is', () => {
    expect(classifyTokenError(503, null).kind).toBe('server');
    expect(classifyTokenError(429, { error: 'rate_limit_exceeded' }).kind).toBe('rate_limit');
    expect(classifyTokenError(400, { error: 'invalid_request' }).kind).toBe('bad_request');
  });

  it('Calendar API statuses map to what the adapter does about them', () => {
    expect(kind(401, { error: { code: 401, status: 'UNAUTHENTICATED' } })).toBe('auth');
    expect(kind(404, {})).toBe('not_found');
    expect(kind(410, {})).toBe('gone');
    expect(kind(409, { error: { errors: [{ reason: 'duplicate' }] } })).toBe('conflict');
    expect(kind(400, {})).toBe('bad_request');
    expect(kind(500, {})).toBe('server');
    expect(kind(503, {})).toBe('server');
  });

  it('a 403 is a rate limit when Google says so and a refusal otherwise', () => {
    for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']) {
      expect(kind(403, { error: { errors: [{ reason }] } }), reason).toBe('rate_limit');
    }
    expect(kind(403, { error: { errors: [{ reason: 'forbiddenForNonOrganizer' }] } })).toBe(
      'forbidden',
    );
    expect(kind(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } })).toBe(
      'forbidden',
    );
    expect(kind(429, {})).toBe('rate_limit');
  });

  it('says which failures are worth another try', () => {
    const retry = (k: ConstructorParameters<typeof GoogleCalendarError>[0]) =>
      new GoogleCalendarError(k, 0, '').retryable;
    expect([
      retry('rate_limit'),
      retry('server'),
      retry('network'),
      retry('timeout'),
      retry('auth'),
    ]).toEqual([true, true, true, true, true]);
    expect([
      retry('bad_request'),
      retry('forbidden'),
      retry('not_found'),
      retry('invalid_grant'),
    ]).toEqual([false, false, false, false]);
  });

  it("carries Google's reason but never needs its text", () => {
    expect(
      classifyApiError(404, { error: { message: 'Not Found', errors: [{ reason: 'notFound' }] } })
        .reason,
    ).toBe('notFound');
    expect(classifyApiError(500, 'not json').reason).toBe('');
  });
});
