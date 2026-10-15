import type { CalendarDriftReason, CalendarUnreadableReason } from '@crm/contracts';
import type { CalendarEventState } from '../../infra/providers/appointments-booking';

/**
 * Deciding whether a Google event has drifted from an appointment (TW-GACC-011). Pure: no clock, no database, no Google.
 *
 * The event is compared with what WE LAST WROTE to it (`pushed`), never with the appointment itself. Three consequences:
 *  - our own change is not drift: an appointment that was just moved differs from the event until its push lands, and that is `pending`;
 *  - a change Google made on its own that touches nothing we wrote (a guest accepting, a Meet link filled in later, a changed etag) is
 *    still `in_sync`;
 *  - only a different time or guest list, or an event that is gone, is drift.
 */
export interface Pushed {
  startsAt: Date | null;
  endsAt: Date | null;
  /** The guests we invited (lower-cased emails, comma-joined and sorted), or null when there were none. */
  attendee: string | null;
  etag: string | null;
}

export interface AppointmentTimes {
  startsAt: Date;
  endsAt: Date;
}

export type DriftVerdict =
  /** Matches what we wrote. `etag` is the event's current one, to be remembered. */
  | { kind: 'in_sync'; etag: string | null }
  /** The appointment differs from what we last wrote: our own push is still on its way. Say nothing about Google. */
  | { kind: 'pending' }
  /** Google would not show this one event (forbidden, bad request). Not drift: nothing is known. */
  | { kind: 'unreadable'; reason: CalendarUnreadableReason }
  | {
      kind: 'drifted';
      reason: CalendarDriftReason;
      googleStartsAt: Date | null;
      googleEndsAt: Date | null;
    };

const sameInstant = (a: Date | null, b: Date | null): boolean =>
  a !== null && b !== null && a.getTime() === b.getTime();

/**
 * `ignore` are the addresses that never show up as a guest of the event: the connected account and the calendar's own address. Google
 * lists the calendar owner as organizer or `self`, which the event state leaves out, so an invitee who IS the owner must not be expected
 * back as a guest (that would read as "guests changed" for ever).
 */
export function judgeDrift(
  appointment: AppointmentTimes,
  pushed: Pushed,
  event: CalendarEventState,
  ignore: readonly string[] = [],
): DriftVerdict {
  const none = { googleStartsAt: null, googleEndsAt: null };
  if (event.kind === 'deleted') return { kind: 'drifted', reason: 'event_deleted', ...none };
  if (event.kind === 'missing') return { kind: 'drifted', reason: 'event_missing', ...none };

  // An event written before the snapshot existed has none: its baseline is the appointment as it is now.
  const base = {
    startsAt: pushed.startsAt ?? appointment.startsAt,
    endsAt: pushed.endsAt ?? appointment.endsAt,
  };
  if (
    !sameInstant(appointment.startsAt, base.startsAt) ||
    !sameInstant(appointment.endsAt, base.endsAt)
  ) {
    return { kind: 'pending' };
  }
  // Untouched since our write: nothing to compare.
  if (event.etag !== null && pushed.etag !== null && event.etag === pushed.etag) {
    return { kind: 'in_sync', etag: event.etag };
  }
  if (
    event.allDay ||
    !sameInstant(event.startsAt, base.startsAt) ||
    !sameInstant(event.endsAt, base.endsAt)
  ) {
    return {
      kind: 'drifted',
      reason: 'time_changed',
      googleStartsAt: event.startsAt,
      googleEndsAt: event.endsAt,
    };
  }
  const skip = new Set(ignore.map((a) => a.trim().toLowerCase()));
  const expected = (pushed.attendee ? pushed.attendee.split(',') : [])
    .filter((a) => !skip.has(a))
    .sort();
  const guests = event.attendees.filter((a) => !skip.has(a)).sort();
  if (guests.length !== expected.length || guests.some((a, i) => a !== expected[i])) {
    return { kind: 'drifted', reason: 'attendees_changed', ...none };
  }
  return { kind: 'in_sync', etag: event.etag };
}

/**
 * When the reconcile of a workspace is next due: an hour after a clean pass (five minutes when the batch left appointments unlooked-at),
 * and after failures it backs off 5, 10, 20 ... minutes up to six hours, so a Google outage or a quota problem is probed gently.
 */
export function nextReconcileDelayMs(input: { failures: number; moreWaiting: boolean }): number {
  if (input.failures > 0) {
    return Math.min(5 * 60_000 * 2 ** (input.failures - 1), 6 * 3_600_000);
  }
  return input.moreWaiting ? 5 * 60_000 : 3_600_000;
}
