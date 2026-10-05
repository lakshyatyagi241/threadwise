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
}

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
}
