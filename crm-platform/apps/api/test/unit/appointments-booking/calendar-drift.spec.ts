import { describe, expect, it, vi } from 'vitest';
import { CALENDAR_DRIFT_REASONS } from '@crm/contracts';
import type { CalendarEventState } from '../../../src/infra/providers/appointments-booking';
import {
  judgeDrift,
  nextReconcileDelayMs,
  type Pushed,
} from '../../../src/modules/appointments-booking/calendar-drift.rules';
import {
  AppointmentDriftNotificationConsumer,
  driftCopy,
} from '../../../src/modules/notifications/appointment-drift-notification.consumer';

const T0 = new Date('2027-01-10T10:00:00Z');
const T1 = new Date('2027-01-10T10:30:00Z');
const appt = { startsAt: T0, endsAt: T1 };
const pushed = (over: Partial<Pushed> = {}): Pushed => ({
  startsAt: T0,
  endsAt: T1,
  attendee: 'a@x.com',
  etag: '"1"',
  ...over,
});
const found = (over: Partial<Extract<CalendarEventState, { kind: 'found' }>> = {}) =>
  ({
    kind: 'found',
    startsAt: T0,
    endsAt: T1,
    allDay: false,
    attendees: ['a@x.com'],
    etag: '"1"',
    ...over,
  }) satisfies CalendarEventState;

describe('judgeDrift: the event is compared with what we last wrote, not with the appointment', () => {
  it('an untouched event (same etag) is in sync without comparing anything else', () => {
    expect(judgeDrift(appt, pushed(), found())).toEqual({ kind: 'in_sync', etag: '"1"' });
  });

  it('a new etag with the same time and guests (a guest answered, a Meet link was filled in) is in sync and remembers the etag', () => {
    expect(judgeDrift(appt, pushed(), found({ etag: '"9"' }))).toEqual({
      kind: 'in_sync',
      etag: '"9"',
    });
  });

  it("a moved start or end is time_changed and carries Google's time", () => {
    const moved = new Date('2027-01-10T12:00:00Z');
    expect(judgeDrift(appt, pushed(), found({ etag: '"2"', startsAt: moved }))).toEqual({
      kind: 'drifted',
      reason: 'time_changed',
      googleStartsAt: moved,
      googleEndsAt: T1,
    });
    expect(
      judgeDrift(appt, pushed(), found({ etag: '"2"', endsAt: new Date('2027-01-10T11:00:00Z') })),
    ).toMatchObject({ kind: 'drifted', reason: 'time_changed' });
  });

  it('an all-day event can never equal a booking', () => {
    expect(
      judgeDrift(
        appt,
        pushed(),
        found({ etag: '"2"', allDay: true, startsAt: null, endsAt: null }),
      ),
    ).toMatchObject({ kind: 'drifted', reason: 'time_changed' });
  });

  it('a different guest list is attendees_changed, in any order, and an added or removed guest both count', () => {
    expect(
      judgeDrift(appt, pushed(), found({ etag: '"2"', attendees: ['a@x.com', 'b@x.com'] })),
    ).toMatchObject({ kind: 'drifted', reason: 'attendees_changed' });
    expect(judgeDrift(appt, pushed(), found({ etag: '"2"', attendees: [] }))).toMatchObject({
      kind: 'drifted',
      reason: 'attendees_changed',
    });
    expect(
      judgeDrift(
        appt,
        pushed({ attendee: 'a@x.com,b@x.com' }),
        found({ etag: '"2"', attendees: ['a@x.com', 'b@x.com'] }),
      ),
    ).toMatchObject({ kind: 'in_sync' });
    expect(
      judgeDrift(appt, pushed({ attendee: null }), found({ etag: '"2"', attendees: ['z@x.com'] })),
    ).toMatchObject({ reason: 'attendees_changed' });
  });

  it('the calendar owner never counts as a guest: an invitee who is the owner is not "guests changed"', () => {
    const owner = pushed({ attendee: 'owner@x.com' });
    // Google lists the owner as `self`, which the event state leaves out.
    expect(judgeDrift(appt, owner, found({ etag: '"2"', attendees: [] }))).toMatchObject({
      reason: 'attendees_changed',
    });
    expect(
      judgeDrift(appt, owner, found({ etag: '"2"', attendees: [] }), ['Owner@X.com']),
    ).toMatchObject({ kind: 'in_sync' });
    // A real extra guest is still seen, owner or not.
    expect(
      judgeDrift(appt, owner, found({ etag: '"2"', attendees: ['z@x.com'] }), ['owner@x.com']),
    ).toMatchObject({ reason: 'attendees_changed' });
    // And an owner listed by Google while we never invited them is not a change either.
    expect(
      judgeDrift(appt, pushed(), found({ etag: '"2"', attendees: ['a@x.com', 'owner@x.com'] }), [
        'owner@x.com',
      ]),
    ).toMatchObject({ kind: 'in_sync' });
  });

  it('a deleted or missing event is drift whatever else is known', () => {
    expect(judgeDrift(appt, pushed(), { kind: 'deleted' })).toMatchObject({
      kind: 'drifted',
      reason: 'event_deleted',
    });
    expect(judgeDrift(appt, pushed(), { kind: 'missing' })).toMatchObject({
      kind: 'drifted',
      reason: 'event_missing',
    });
  });

  it('our own move that has not been pushed yet is pending, never drift (the echo guard)', () => {
    const movedAppt = { startsAt: T1, endsAt: new Date('2027-01-10T11:00:00Z') };
    expect(judgeDrift(movedAppt, pushed(), found())).toEqual({ kind: 'pending' });
    expect(judgeDrift(movedAppt, pushed(), found({ etag: '"5"' }))).toEqual({ kind: 'pending' });
    // ...but a deleted event is still gone.
    expect(judgeDrift(movedAppt, pushed(), { kind: 'deleted' })).toMatchObject({ kind: 'drifted' });
  });

  it('an event written before the snapshot existed takes the appointment as its baseline', () => {
    const none = pushed({ startsAt: null, endsAt: null, etag: null });
    expect(judgeDrift(appt, none, found())).toMatchObject({ kind: 'in_sync' });
    expect(judgeDrift(appt, none, found({ startsAt: T1 }))).toMatchObject({
      reason: 'time_changed',
    });
  });

  it('only ever answers with a reason the contract lists', () => {
    const reasons = [
      judgeDrift(appt, pushed(), { kind: 'deleted' }),
      judgeDrift(appt, pushed(), { kind: 'missing' }),
      judgeDrift(appt, pushed(), found({ etag: '"2"', startsAt: T1 })),
      judgeDrift(appt, pushed(), found({ etag: '"2"', attendees: [] })),
    ].map((v) => (v.kind === 'drifted' ? v.reason : null));
    expect(new Set(reasons)).toEqual(new Set(CALENDAR_DRIFT_REASONS));
  });
});

describe('nextReconcileDelayMs', () => {
  const MIN = 60_000;
  it('is an hour after a clean pass and five minutes when the batch left work', () => {
    expect(nextReconcileDelayMs({ failures: 0, moreWaiting: false })).toBe(60 * MIN);
    expect(nextReconcileDelayMs({ failures: 0, moreWaiting: true })).toBe(5 * MIN);
  });
  it('backs off 5, 10, 20 minutes ... and stops at six hours', () => {
    expect(
      [1, 2, 3, 4].map((failures) => nextReconcileDelayMs({ failures, moreWaiting: true })),
    ).toEqual([5 * MIN, 10 * MIN, 20 * MIN, 40 * MIN]);
    expect(nextReconcileDelayMs({ failures: 30, moreWaiting: false })).toBe(6 * 60 * MIN);
  });
});

describe('the drift notification', () => {
  it('words each reason and always says the appointment was not changed', () => {
    for (const reason of CALENDAR_DRIFT_REASONS) {
      const c = driftCopy('Consult', reason);
      expect(c.title).toBe('Calendar out of sync: Consult');
      expect(c.body).toMatch(/has not been changed/);
      expect(c.body.length).toBeGreaterThan(40);
    }
    expect(driftCopy('x', 'time_changed').body).toMatch(/moved/);
    expect(driftCopy('x', 'event_deleted').body).toMatch(/deleted/);
  });

  function build(active: boolean) {
    const write = vi.fn(async (_tx, _org, _type, users: number[], make: () => unknown) => {
      make();
      return users.map((u) => ({ userId: u }));
    });
    const publish = vi.fn(async () => undefined);
    const db = {
      txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: active ? [{ id: 7 }] : [] }) }),
    };
    const consumer = new AppointmentDriftNotificationConsumer(
      db as never,
      { register: vi.fn() } as never,
      { write, publish } as never,
    );
    return { consumer, write, publish };
  }
  const event = (payload: Record<string, unknown>) =>
    ({
      id: '42',
      orgId: 1,
      aggregateModule: 'appointments',
      aggregateId: '1',
      eventType: 'appointment.calendar_drifted',
      payload,
    }) as never;

  it('tells the owner once, with a link to the appointment and a dedupe key per detection', async () => {
    const { consumer, write, publish } = build(true);
    await consumer.handle(
      event({ uuid: 'u-1', reason: 'time_changed', ownerUserId: 7, title: 'T' }),
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![2]).toBe('appointment_calendar_drift');
    expect(write.mock.calls[0]![3]).toEqual([7]);
    const made = (write.mock.calls[0]![4] as () => Record<string, unknown>)();
    expect(made).toMatchObject({
      link: '/appointments?appt=u-1',
      dedupeKey: 'appointment-drift:u-1:42',
      data: { appointmentId: 'u-1', reason: 'time_changed' },
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('says nothing for an unknown reason, a missing owner or an owner who is no longer active', async () => {
    for (const [active, payload] of [
      [true, { uuid: 'u', reason: 'nonsense', ownerUserId: 7 }],
      [true, { uuid: 'u', reason: 'time_changed', ownerUserId: null }],
      [true, { reason: 'time_changed', ownerUserId: 7 }],
      [false, { uuid: 'u', reason: 'time_changed', ownerUserId: 7 }],
    ] as const) {
      const { consumer, write } = build(active);
      await consumer.handle(event(payload));
      expect(write).not.toHaveBeenCalled();
    }
  });
});
