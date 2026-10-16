import type {
  CalendarBusyInterval,
  CalendarEventRequest,
  CalendarEventState,
} from './calendar-sync.port';
import { mergeIntervals } from './google-calendar.mapping';

/**
 * Pure translation between the calendar port and Microsoft Graph's event JSON (no I/O: unit-tested). The shapes were written from
 * learn.microsoft.com (event resource, calendarView, singleValueLegacyExtendedProperty) and are not verified against a live tenant.
 */

/**
 * Every event we write carries these two private properties, so our events can be told from the owner's own and listed by them. The GUID is
 * the namespace of our custom property (Graph requires one); it is fixed and not a secret.
 */
export const OWN_PROPERTY_NAMESPACE = '8d1b1f0e-6a3f-4f4e-9d1c-5a2b7c3d9e10';
export const OWN_EVENT_PROPERTY_ID = `String {${OWN_PROPERTY_NAMESPACE}} Name crmManaged`;
export const APPOINTMENT_PROPERTY_ID = `String {${OWN_PROPERTY_NAMESPACE}} Name crmAppointment`;

/** Graph accepts `2026-10-05T03:30:00` plus a time-zone name; the instants we pass are UTC. */
export function graphDateTime(d: Date): { dateTime: string; timeZone: 'UTC' } {
  return { dateTime: d.toISOString().slice(0, 19), timeZone: 'UTC' };
}

export interface GraphEventBody {
  subject: string;
  body: { contentType: 'text'; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location: { displayName: string };
  attendees?: Array<{ emailAddress: { address: string; name?: string }; type: 'required' }>;
  showAs: 'busy';
  isReminderOn: true;
  /** Graph's own idempotency key for a create: a repeat of the same POST finds the event it already made. Insert only. */
  transactionId?: string;
  isOnlineMeeting?: true;
  onlineMeetingProvider?: 'teamsForBusiness';
  singleValueExtendedProperties?: Array<{ id: string; value: string }>;
}

/**
 * The event as Graph wants it. A PATCH sends an empty location and body to clear what an earlier version had, and an attendee list that
 * is empty when the booking has no email any more; an insert leaves out what is not there. The meeting room (Teams) and the
 * idempotency key are asked for on insert only.
 */
export function buildGraphEventBody(
  req: CalendarEventRequest,
  mode: 'insert' | 'patch',
): GraphEventBody {
  const body: GraphEventBody = {
    subject: req.title,
    body: { contentType: 'text', content: req.description?.trim() ? req.description : '' },
    start: graphDateTime(req.startsAt),
    end: graphDateTime(req.endsAt),
    location: { displayName: req.location?.trim() ? req.location : '' },
    showAs: 'busy',
    isReminderOn: true,
  };
  if (req.attendeeEmail) {
    body.attendees = [
      {
        emailAddress: req.attendeeName
          ? { address: req.attendeeEmail, name: req.attendeeName }
          : { address: req.attendeeEmail },
        type: 'required',
      },
    ];
  } else if (mode === 'patch') {
    body.attendees = [];
  }
  if (mode === 'insert') {
    body.transactionId = req.appointmentId;
    body.singleValueExtendedProperties = [
      { id: OWN_EVENT_PROPERTY_ID, value: '1' },
      { id: APPOINTMENT_PROPERTY_ID, value: req.appointmentId },
    ];
    if (req.createMeet) {
      body.isOnlineMeeting = true;
      body.onlineMeetingProvider = 'teamsForBusiness';
    }
  }
  return body;
}

interface GraphDateTime {
  dateTime?: unknown;
  timeZone?: unknown;
}

/** An instant from Graph's `{ dateTime, timeZone }`. We ask for UTC (`Prefer: outlook.timezone="UTC"`), and a value with no zone is read as UTC. */
export function parseGraphTime(value: unknown): Date | null {
  const v = (value ?? {}) as GraphDateTime;
  if (typeof v.dateTime !== 'string' || !v.dateTime) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(v.dateTime);
  const ms = Date.parse(hasZone ? v.dateTime : `${v.dateTime}Z`);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** The join address of an online meeting on an event, when Graph made one. */
export function joinUrlOf(event: unknown): string | null {
  const e = (event ?? {}) as {
    onlineMeeting?: { joinUrl?: unknown } | null;
    onlineMeetingUrl?: unknown;
  };
  const url = e.onlineMeeting?.joinUrl ?? e.onlineMeetingUrl;
  return typeof url === 'string' && url ? url : null;
}

interface GraphCalendarViewItem {
  start?: unknown;
  end?: unknown;
  showAs?: string;
  isCancelled?: boolean;
  isAllDay?: boolean;
  singleValueExtendedProperties?: Array<{ id?: string; value?: string }> | null;
}

/** What blocks a slot. `free` and `workingElsewhere` do not; a cancelled meeting does not. */
const BLOCKING = new Set(['busy', 'oof', 'tentative', 'unknown']);

function intervalOf(item: GraphCalendarViewItem): CalendarBusyInterval | null {
  const start = parseGraphTime(item.start);
  const end = parseGraphTime(item.end);
  if (!start || !end || end.getTime() <= start.getTime()) return null;
  return { start, end };
}

/** The busy intervals out of a `calendarView` answer, merged. */
export function busyIntervalsOf(items: readonly unknown[]): CalendarBusyInterval[] {
  const out: CalendarBusyInterval[] = [];
  for (const raw of items) {
    const item = raw as GraphCalendarViewItem;
    if (item.isCancelled) continue;
    if (item.showAs !== undefined && !BLOCKING.has(item.showAs)) continue;
    const interval = intervalOf(item);
    if (interval) out.push(interval);
  }
  return mergeIntervals(out);
}

/** The events this platform wrote (they carry our private property) out of a `calendarView` answer. */
export function ownIntervalsOf(items: readonly unknown[]): CalendarBusyInterval[] {
  const out: CalendarBusyInterval[] = [];
  for (const raw of items) {
    const item = raw as GraphCalendarViewItem;
    if (item.isCancelled) continue;
    const ours = (item.singleValueExtendedProperties ?? []).some(
      (p) => p.id?.toLowerCase() === OWN_EVENT_PROPERTY_ID.toLowerCase() && p.value === '1',
    );
    if (!ours) continue;
    const interval = intervalOf(item);
    if (interval) out.push(interval);
  }
  return out;
}

interface GraphEventShape {
  isCancelled?: boolean;
  isAllDay?: boolean;
  start?: unknown;
  end?: unknown;
  '@odata.etag'?: string;
  attendees?: Array<{ type?: string; emailAddress?: { address?: string } }>;
}

/**
 * What the reconcile needs from an event Graph returned: gone (the organizer cancelled it: `isCancelled`), or its time, guests and
 * version tag. Rooms and equipment are not guests.
 */
export function graphEventStateOf(event: unknown): CalendarEventState {
  const e = (event ?? {}) as GraphEventShape;
  if (e.isCancelled) return { kind: 'deleted' };
  const attendees = (e.attendees ?? [])
    .filter((a) => a.type !== 'resource' && typeof a.emailAddress?.address === 'string')
    .map((a) => String(a.emailAddress!.address).trim().toLowerCase())
    .sort();
  return {
    kind: 'found',
    startsAt: parseGraphTime(e.start),
    endsAt: parseGraphTime(e.end),
    allDay: e.isAllDay === true,
    attendees,
    etag: typeof e['@odata.etag'] === 'string' ? e['@odata.etag'] : null,
  };
}
