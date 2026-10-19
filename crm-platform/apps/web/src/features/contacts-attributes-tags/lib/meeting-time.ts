import type {
  CreateContactMeetingInput,
  MeetingConferencingInput,
  UpdateContactMeetingInput,
} from '@crm/contracts';

/**
 * Meeting times. The form uses `<input type="datetime-local">`, whose value is a wall-clock "2026-10-16T14:30" with no zone;
 * the API stores an instant (ISO 8601 with Z). The wall-clock is read in the viewer's zone (the app's `timeZone` when it has
 * one, else the browser's), the same zone the list prints the times in.
 */

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** How far `timeZone` is ahead of UTC at this instant, in milliseconds. */
function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** "2026-10-16T14:30" read in `timeZone` -> "2026-10-16T09:00:00.000Z"; null for an empty or impossible value (Feb 31). */
export function zonedLocalToIso(local: string, timeZone?: string): string | null {
  const m = LOCAL.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(wall);
  // Date rolls an impossible day over to the next month; a value that does not read back the same was not a real time.
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d ||
    h > 23 ||
    mi > 59
  ) {
    return null;
  }
  if (!timeZone) return new Date(y, mo - 1, d, h, mi).toISOString();
  try {
    // Two passes settle the offset around a daylight-saving change.
    const first = wall - offsetMs(wall, timeZone);
    return new Date(wall - offsetMs(first, timeZone)).toISOString();
  } catch {
    // An unknown zone name: fall back to the browser's.
    return new Date(y, mo - 1, d, h, mi).toISOString();
  }
}

const two = (n: number) => String(n).padStart(2, '0');

/** An instant -> the "YYYY-MM-DDTHH:mm" a datetime-local input takes, in `timeZone`; empty for no or a bad value. */
export function isoToZonedLocal(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (!timeZone) {
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  } catch {
    return isoToZonedLocal(iso);
  }
}

/** The end may not be before the start (equal is fine, and either may be empty). Both are datetime-local values, which sort as text. */
export function meetingRangeProblem(startLocal: string, endLocal: string): 'endBeforeStart' | null {
  if (!startLocal || !endLocal) return null;
  return endLocal < startLocal ? 'endBeforeStart' : null;
}

export interface MeetingFormValues {
  title: string;
  startsAt: string;
  endsAt: string;
  location: string;
  /** The video link and calendar entry asked for (BL-360); left out, the request says nothing about them. */
  conferencing?: MeetingConferencingInput;
}

/** The request part for video and calendar: the browser's zone goes with it, because a calendar event and a Zoom meeting need one. */
const conferencingPart = (v: MeetingFormValues, timeZone?: string) =>
  v.conferencing
    ? { conferencing: { ...v.conferencing, ...(timeZone ? { timeZone } : {}) } }
    : {};

export const MEETING_TITLE_MAX = 255;
export const MEETING_LOCATION_MAX = 255;

export const EMPTY_MEETING: MeetingFormValues = {
  title: '',
  startsAt: '',
  endsAt: '',
  location: '',
};

export type MeetingProblem =
  | 'titleRequired'
  | 'titleTooLong'
  | 'locationTooLong'
  | 'endBeforeStart'
  | 'startInvalid'
  | 'endInvalid';

/** The problems of the form, by field. */
export type MeetingProblems = Partial<
  Record<'title' | 'startsAt' | 'endsAt' | 'location', MeetingProblem>
>;

/** What is wrong with the form, by field, for the messages under the inputs. */
export function validateMeeting(v: MeetingFormValues, timeZone?: string): MeetingProblems {
  const out: MeetingProblems = {};
  const title = v.title.trim();
  if (!title) out.title = 'titleRequired';
  else if (title.length > MEETING_TITLE_MAX) out.title = 'titleTooLong';
  if (v.location.trim().length > MEETING_LOCATION_MAX) out.location = 'locationTooLong';
  if (v.startsAt && zonedLocalToIso(v.startsAt, timeZone) === null) out.startsAt = 'startInvalid';
  if (v.endsAt && zonedLocalToIso(v.endsAt, timeZone) === null) out.endsAt = 'endInvalid';
  if (!out.startsAt && !out.endsAt) {
    const range = meetingRangeProblem(v.startsAt, v.endsAt);
    if (range) out.endsAt = range;
  }
  return out;
}

/** The create request: empty times and location are left out. */
export function toCreateMeeting(
  v: MeetingFormValues,
  timeZone?: string,
): CreateContactMeetingInput {
  const startsAt = v.startsAt ? zonedLocalToIso(v.startsAt, timeZone) : null;
  const endsAt = v.endsAt ? zonedLocalToIso(v.endsAt, timeZone) : null;
  const location = v.location.trim();
  return {
    title: v.title.trim(),
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
    ...(location ? { location } : {}),
    ...conferencingPart(v, timeZone),
  };
}

/** The edit request: a cleared time or location is sent as null so it is cleared; `rowVersion` is the one the person saw. */
export function toUpdateMeeting(
  v: MeetingFormValues,
  rowVersion: number,
  timeZone?: string,
): UpdateContactMeetingInput {
  return {
    title: v.title.trim(),
    startsAt: v.startsAt ? zonedLocalToIso(v.startsAt, timeZone) : null,
    endsAt: v.endsAt ? zonedLocalToIso(v.endsAt, timeZone) : null,
    location: v.location.trim() || null,
    ...conferencingPart(v, timeZone),
    rowVersion,
  };
}
