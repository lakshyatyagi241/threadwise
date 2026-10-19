import type { ContactMeetingResponse } from '@crm/contracts';
import { isClosedBooking } from './meeting-booking';
import { EMPTY_MEETING, isoToZonedLocal, type MeetingFormValues } from './meeting-time';

/**
 * The inline "Schedule meeting" row. The API stores a title, a start, an end and a place; the row asks for a start, a duration and
 * an optional link (or place), and the end is worked out from the first two. All times here are wall-clock `datetime-local` strings
 * ("2026-10-16T14:30") in the viewer's zone, the same as the form they replace.
 */

/** The durations the row offers, in minutes. */
export const DURATIONS = [15, 30, 45, 60, 90, 120] as const;
export const DEFAULT_DURATION = 30;

/** A duration choice: one of the minutes, no end at all, or the end the meeting already has (an edit whose length is not on the list). */
export type DurationChoice = `${(typeof DURATIONS)[number]}` | 'none' | 'custom';

export interface InlineMeetingDraft {
  title: string;
  startsAt: string;
  duration: DurationChoice;
  /** The end, read only while `duration` is `custom`. */
  endsAt: string;
  /** A video-call link or a place; sent as the meeting's location. */
  location: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-16T14:30" plus minutes, as wall-clock arithmetic (no zone, so no daylight-saving surprise inside the form). */
export function addMinutes(local: string, minutes: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return '';
  const t = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) + minutes * 60_000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Whole minutes from one wall-clock time to another, or null when either is empty or invalid. */
export function minutesBetween(start: string, end: string): number | null {
  const parse = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
    return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) : null;
  };
  const a = parse(start);
  const b = parse(end);
  return a === null || b === null ? null : Math.round((b - a) / 60_000);
}

/** The next whole hour after `now`, in `timeZone`, as a `datetime-local` value: where a new meeting starts. */
export function nextHour(now: Date, timeZone?: string): string {
  const local = isoToZonedLocal(now.toISOString(), timeZone);
  return addMinutes(`${local.slice(0, 13)}:00`, 60);
}

export const emptyInlineMeeting = (now: Date, timeZone?: string): InlineMeetingDraft => ({
  title: '',
  startsAt: nextHour(now, timeZone),
  duration: String(DEFAULT_DURATION) as DurationChoice,
  endsAt: '',
  location: '',
});

/** The row for a meeting that exists: its length is a choice when it is one of the offered, else the end is kept as it is. */
export function draftOf(m: ContactMeetingResponse, timeZone?: string): InlineMeetingDraft {
  const startsAt = isoToZonedLocal(m.startsAt, timeZone);
  const endsAt = isoToZonedLocal(m.endsAt, timeZone);
  let duration: DurationChoice;
  if (!endsAt) duration = 'none';
  else {
    const minutes = startsAt ? minutesBetween(startsAt, endsAt) : null;
    duration = DURATIONS.some((d) => d === minutes)
      ? (String(minutes) as DurationChoice)
      : 'custom';
  }
  return { title: m.title, startsAt, duration, endsAt, location: m.location ?? '' };
}

/** The values the existing meeting validation and request builders take. */
export function valuesOf(d: InlineMeetingDraft): MeetingFormValues {
  const endsAt =
    d.duration === 'none'
      ? ''
      : d.duration === 'custom'
        ? d.endsAt
        : d.startsAt
          ? addMinutes(d.startsAt, Number(d.duration))
          : '';
  return { ...EMPTY_MEETING, title: d.title, startsAt: d.startsAt, endsAt, location: d.location };
}

export type MeetingGroup = 'upcoming' | 'past' | 'undated';

/**
 * Splits a contact's meetings for the list: the ones still ahead (soonest first), the ones behind (latest first), and the ones
 * logged with no start. A meeting that has started but not yet ended counts as upcoming. A booking that was cancelled or declined
 * is never still ahead: it sits with the past ones, tagged.
 */
export function groupMeetings(
  meetings: readonly ContactMeetingResponse[],
  now: Date,
): Record<MeetingGroup, ContactMeetingResponse[]> {
  const out: Record<MeetingGroup, ContactMeetingResponse[]> = {
    upcoming: [],
    past: [],
    undated: [],
  };
  const t = now.getTime();
  for (const m of meetings) {
    if (!m.startsAt) {
      out.undated.push(m);
      continue;
    }
    const end = m.endsAt ? Date.parse(m.endsAt) : Date.parse(m.startsAt);
    (end >= t && !isClosedBooking(m) ? out.upcoming : out.past).push(m);
  }
  out.upcoming.sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!));
  out.past.sort((a, b) => Date.parse(b.startsAt!) - Date.parse(a.startsAt!));
  return out;
}

/** Whether `value` reads as a web link (the row shows it as one); anything else is a place and stays plain text. */
export function asLink(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(v)) return null;
  try {
    const url = new URL(v);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
