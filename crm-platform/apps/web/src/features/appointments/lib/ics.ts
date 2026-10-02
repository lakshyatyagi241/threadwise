/**
 * An iCalendar (RFC 5545) file for "Add to calendar" on the confirmation and manage pages. Times are written in UTC, which
 * every calendar app converts to the person's own zone; text is escaped and lines are folded at 75 octets, as the format
 * requires. Pure: the page turns the string into a download.
 */

export interface IcsEvent {
  /** Stable id of the event, so re-adding it updates instead of duplicating. */
  uid: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  description?: string | null;
  /** A link shown in the event (the manage page). */
  url?: string | null;
  /** The moment the file is made; a parameter so a test is deterministic. */
  now?: Date;
  /** `CANCELLED` writes a cancellation instead of an invitation. */
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `20261005T093000Z`. */
export function icsTime(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Backslash, semicolon, comma and line breaks, the characters a TEXT value must escape. */
export function icsEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line at 75 octets without splitting a character; continuation lines start with one space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) {
      out.push(current);
      current = '';
      size = 0;
      limit = 74;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** The whole `.ics` text for one event, CRLF line endings. */
export function buildIcs(e: IcsEvent): string {
  const stamp = icsTime(e.now ?? new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CRM//Appointments//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${e.status === 'CANCELLED' ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${icsEscape(e.uid)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsTime(e.startsAt)}`,
    `DTEND:${icsTime(e.endsAt)}`,
    `SUMMARY:${icsEscape(e.title)}`,
    `STATUS:${e.status ?? 'CONFIRMED'}`,
  ];
  if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
  if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** A name that is safe as a file name: letters and digits, dashes, `.ics`. */
export function icsFileName(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'booking'}.ics`;
}

/** A Google Calendar "add event" link, for the people who prefer it to a file. */
export function googleCalendarUrl(
  e: Pick<IcsEvent, 'title' | 'startsAt' | 'endsAt' | 'location' | 'description'>,
): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${icsTime(e.startsAt)}/${icsTime(e.endsAt)}`,
  });
  if (e.location) p.set('location', e.location);
  if (e.description) p.set('details', e.description);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
