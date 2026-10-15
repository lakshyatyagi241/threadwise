/**
 * The port between appointments and whatever keeps an external calendar (Google, Outlook, CalDAV) in step with them (TW-APPT-012, 028,
 * 029; EXT-APPT-08). Reference called Google inline from the booking controllers; here the domain only ever talks to this interface, so a
 * provider is one adapter file and a booking never fails because a calendar is down.
 *
 * Infra knows nothing about booking types or tenants: the requests are plain data. The domain writes the returned event id and Meet URL
 * back to the appointment. Every call is expected to time out on its own (an adapter's HTTP client carries the timeout) and to throw
 * on failure: the caller (a worker consumer) retries with the outbox's backoff, so an adapter must be idempotent on
 * `existingEventId` (update, not create, when it is set) and, when it is not set, on `appointmentId`: a retry after a lost answer
 * (the event was written but the id never reached the appointment) must find that event, not make a second one.
 */

export const APPOINTMENT_CALENDAR = Symbol('APPOINTMENT_CALENDAR');

export interface CalendarStatus {
  connected: boolean;
  /** The connected account to show ("ana@example.com"), when there is one. */
  account: string | null;
}

export interface CalendarBusyInterval {
  start: Date;
  end: Date;
}

export interface CalendarFreeBusyOptions {
  /**
   * Leave out the events this platform wrote itself. A group type (more than one seat per slot) must not be closed by the first
   * booking's own event, and the one-to-one case is already counted by the booking.
   */
  ignoreOwnEvents?: boolean;
}

export interface CalendarEventRequest {
  orgId: number;
  /** The appointment's uuid, a stable key an adapter can store on the event. */
  appointmentId: string;
  /** null = the adapter's default (Google: `primary`). */
  calendarId: string | null;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  attendeeEmail: string | null;
  attendeeName: string | null;
  /** Ask the provider for a video-call link. */
  createMeet: boolean;
  /** Set when the event exists already: update it in place. */
  existingEventId: string | null;
}

export interface CalendarEventResult {
  eventId: string;
  calendarId: string | null;
  meetUrl: string | null;
  /** The provider's version tag of the event as we left it (Google's `etag`): the echo guard of the reconcile. */
  etag?: string | null;
}

/**
 * An event as the provider shows it now, for the reconcile (TW-GACC-011): `deleted` (410, or status cancelled), `missing` (404), or what
 * it holds. Times are instants; an all-day event has none (`allDay`), which can never equal a booking.
 */
export type CalendarEventState =
  | { kind: 'deleted' }
  | { kind: 'missing' }
  | {
      kind: 'found';
      startsAt: Date | null;
      endsAt: Date | null;
      allDay: boolean;
      /** Guest emails, lower-cased, without the organizer, the calendar's own entry and resource rooms. */
      attendees: string[];
      etag: string | null;
    };

export interface CalendarSyncPort {
  /** The provider key ("google", "none"). */
  readonly provider: string;
  status(orgId: number): Promise<CalendarStatus>;
  /** Busy intervals of a calendar in a range; the slot engine blocks them (with buffers). */
  freeBusy(
    orgId: number,
    calendarId: string | null,
    from: Date,
    to: Date,
    options?: CalendarFreeBusyOptions,
  ): Promise<CalendarBusyInterval[]>;
  /** Creates the event, or updates `existingEventId`. Null = nothing was written (not connected). */
  upsertEvent(request: CalendarEventRequest): Promise<CalendarEventResult | null>;
  deleteEvent(orgId: number, calendarId: string | null, eventId: string): Promise<void>;
  /**
   * Reads one event by id and reports what it holds (never throws for "gone": that is an answer). Throws for a failure to ask (provider
   * down, rate limit, grant refused) so the caller can stop and back off instead of reading "could not look" as "drifted".
   */
  readEvent(orgId: number, calendarId: string | null, eventId: string): Promise<CalendarEventState>;
  /**
   * Whether the calendar itself still exists and is visible to the connected account. A 404 on an EVENT of a calendar that is gone is not
   * the event's drift, so the reconcile asks this before it reads "missing" as an answer about one appointment. Throws like `readEvent`.
   */
  calendarExists(orgId: number, calendarId: string | null): Promise<boolean>;
}
