import type { CalendarBusyInterval, CalendarEventRequest } from './calendar-sync.port';

/**
 * Pure translation between the calendar port and Google's Calendar v3 JSON (no I/O: unit-tested).
 */

/** Every event we write carries these private properties, so our events can be told from the owner's own (and listed by them). */
export const OWN_EVENT_KEY = 'crmManaged';
export const APPOINTMENT_EVENT_KEY = 'crmAppointment';

/**
 * The Google event id for an appointment. Google lets the client choose an id (base32hex: `a-v` and `0-9`, 5 to 1024 characters); a uuid
 * without its dashes is 32 hex digits, which is inside that alphabet. A fixed id is what makes the insert idempotent: when a retry
 * repeats an insert whose answer was lost, Google replies 409 (the event exists) instead of creating a second one.
 */
export function eventIdFor(appointmentId: string): string {
  const id = appointmentId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-v]{5,1024}$/.test(id)) throw new Error('appointment id cannot be a Google event id');
  return id;
}

export interface GoogleEventBody {
  id?: string;
  status?: 'confirmed';
  summary: string;
  description?: string | null;
  location?: string | null;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees?: Array<{ email: string; displayName?: string }>;
  reminders: { useDefault: true };
  extendedProperties: { private: Record<string, string> };
  conferenceData?: {
    createRequest: { requestId: string; conferenceSolutionKey: { type: 'hangoutsMeet' } };
  };
}

/**
 * The event as Google wants it. `patch` sends `null` for an empty description or location so a PATCH clears what an earlier version
 * had; an insert simply leaves them out. `status: confirmed` also brings back an event that was deleted (Google keeps a deleted event as
 * `cancelled`, and an insert with its id is a 409), which is how a cancelled-then-restored booking lands on its own old event.
 */
export function buildEventBody(
  req: CalendarEventRequest,
  eventId: string,
  mode: 'insert' | 'patch',
): GoogleEventBody {
  const empty = mode === 'patch' ? null : undefined;
  const body: GoogleEventBody = {
    summary: req.title,
    description: req.description?.trim() ? req.description : empty,
    location: req.location?.trim() ? req.location : empty,
    start: { dateTime: req.startsAt.toISOString(), timeZone: req.timezone },
    end: { dateTime: req.endsAt.toISOString(), timeZone: req.timezone },
    reminders: { useDefault: true },
    status: 'confirmed',
    extendedProperties: {
      private: { [OWN_EVENT_KEY]: '1', [APPOINTMENT_EVENT_KEY]: req.appointmentId },
    },
  };
  if (mode === 'insert') body.id = eventId;
  if (req.attendeeEmail) {
    body.attendees = [
      req.attendeeName
        ? { email: req.attendeeEmail, displayName: req.attendeeName }
        : { email: req.attendeeEmail },
    ];
  }
  if (req.createMeet) {
    // The same request id on every write: Google ignores a repeat of a request it already served, so a retry or a reschedule never
    // makes a second Meet room.
    body.conferenceData = {
      createRequest: {
        requestId: req.appointmentId,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }
  return body;
}

interface GoogleEventLike {
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
}

/** The Meet address of an event: `hangoutLink`, else the first video entry point (Google fills one before the other). */
export function meetUrlOf(event: unknown): string | null {
  const e = (event ?? {}) as GoogleEventLike;
  if (typeof e.hangoutLink === 'string' && e.hangoutLink) return e.hangoutLink;
  const video = e.conferenceData?.entryPoints?.find(
    (p) => p.entryPointType === 'video' && typeof p.uri === 'string' && p.uri,
  );
  return video?.uri ?? null;
}

function toInterval(start: unknown, end: unknown): CalendarBusyInterval | null {
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  return { start: new Date(s), end: new Date(e) };
}

/** Sorts and joins intervals that overlap or touch: the shape Google's free/busy answers in. */
export function mergeIntervals(list: CalendarBusyInterval[]): CalendarBusyInterval[] {
  const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: CalendarBusyInterval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start.getTime() <= last.end.getTime()) {
      if (i.end.getTime() > last.end.getTime()) last.end = i.end;
    } else {
      out.push({ start: i.start, end: i.end });
    }
  }
  return out;
}

/**
 * The busy intervals of one calendar out of a `freeBusy.query` answer. A calendar Google could not read (deleted, no access) comes back
 * under `calendars[id].errors`: that is not "free", so it is reported to the caller as an error rather than as an empty list.
 */
export function parseFreeBusy(
  body: unknown,
  calendarId: string,
): { busy: CalendarBusyInterval[]; error: string | null } {
  const cal = (body as { calendars?: Record<string, unknown> } | null)?.calendars?.[calendarId] as
    | { busy?: Array<{ start?: unknown; end?: unknown }>; errors?: Array<{ reason?: string }> }
    | undefined;
  if (!cal) return { busy: [], error: 'calendar missing from the answer' };
  if (cal.errors?.length) return { busy: [], error: cal.errors[0]?.reason ?? 'unknown' };
  const busy = (cal.busy ?? [])
    .map((b) => toInterval(b.start, b.end))
    .filter((b): b is CalendarBusyInterval => b !== null);
  return { busy: mergeIntervals(busy), error: null };
}

/** Timed events of a `events.list` answer as intervals (all-day events have `date`, not `dateTime`: they are not appointments of ours). */
export function parseEventIntervals(body: unknown): CalendarBusyInterval[] {
  const items =
    (
      body as {
        items?: Array<{
          status?: string;
          start?: { dateTime?: unknown };
          end?: { dateTime?: unknown };
        }>;
      } | null
    )?.items ?? [];
  return items
    .filter((i) => i.status !== 'cancelled')
    .map((i) => toInterval(i.start?.dateTime, i.end?.dateTime))
    .filter((i): i is CalendarBusyInterval => i !== null);
}

/**
 * Takes our own events out of a busy list. Google reports an event as one block, or joined with neighbours it touches, so an interval
 * is dropped only when it is exactly one of ours (after joining ours the same way): a block that is also covered by somebody else's
 * event is a different block and stays. Never frees time somebody else holds.
 */
export function withoutOwnEvents(
  busy: CalendarBusyInterval[],
  own: CalendarBusyInterval[],
): CalendarBusyInterval[] {
  if (own.length === 0) return busy;
  const ours = mergeIntervals(own);
  return busy.filter(
    (b) =>
      !ours.some(
        (o) => o.start.getTime() === b.start.getTime() && o.end.getTime() === b.end.getTime(),
      ),
  );
}
