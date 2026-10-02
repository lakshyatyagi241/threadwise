/**
 * An appointment as an iCalendar file (EXT-APPT-06, RFC 5545): one VEVENT in UTC, CRLF line endings, text escaped and lines folded at
 * 75 octets, so Google, Apple and Outlook all open it. `SEQUENCE` follows the row version so a moved booking replaces the old event
 * in the invitee's calendar instead of duplicating it, and a cancelled one carries `STATUS:CANCELLED`.
 */

export interface IcsInput {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  startsAt: Date;
  endsAt: Date;
  status: 'pending' | 'confirmed' | 'cancelled' | 'declined' | 'completed' | 'no_show';
  /** Bumped on every change of the booking. */
  sequence: number;
  /** When the booking was last changed (DTSTAMP). */
  stampedAt: Date;
  organizer?: { name: string; email: string } | null;
  prodId?: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `20261002T090000Z`. */
export function icsDateTime(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** TEXT values: backslash, semicolon, comma and newlines escaped; other control characters dropped. */
export function icsEscape(text: string): string {
  return (
    text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  );
}

/** Folds a content line at 75 octets (not in the middle of a UTF-8 character); continuation lines start with one space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(current);
      current = '';
      bytes = 0;
      limit = 74; // the leading space of a continuation line counts
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

const STATUS: Record<IcsInput['status'], 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED'> = {
  pending: 'TENTATIVE',
  confirmed: 'CONFIRMED',
  completed: 'CONFIRMED',
  no_show: 'CONFIRMED',
  cancelled: 'CANCELLED',
  declined: 'CANCELLED',
};

export function buildIcs(e: IcsInput): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${e.prodId ?? '-//Booking//Appointments//EN'}`,
    'CALSCALE:GREGORIAN',
    // A cancelled booking is sent as a cancellation of the event of the same UID.
    `METHOD:${STATUS[e.status] === 'CANCELLED' ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${icsEscape(e.uid)}`,
    `DTSTAMP:${icsDateTime(e.stampedAt)}`,
    `DTSTART:${icsDateTime(e.startsAt)}`,
    `DTEND:${icsDateTime(e.endsAt)}`,
    `SEQUENCE:${Math.max(0, e.sequence)}`,
    `SUMMARY:${icsEscape(e.title)}`,
    `STATUS:${STATUS[e.status]}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
  if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
  if (e.url) lines.push(`URL:${e.url.replace(/[\r\n]/g, '')}`);
  if (e.organizer)
    lines.push(
      `ORGANIZER;CN=${icsEscape(e.organizer.name).replace(/:/g, '')}:mailto:${e.organizer.email.replace(/[\r\n]/g, '')}`,
    );
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
