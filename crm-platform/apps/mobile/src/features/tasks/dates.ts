/**
 * Dates for tasks. The API takes a due date as a full timestamp with a UTC offset, never a bare date read as midnight, and the form
 * has no native date picker, so the person types a day and a time and this file turns the pair into that timestamp (and back).
 */

const DATE_TEXT = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const TIME_TEXT = /^(\d{1,2}):(\d{2})$/;

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "2026-10-5" becomes "2026-10-05". Null when the text is not a day that exists on the calendar (no 31 February). */
export function parseDateText(text: string): string | null {
  const match = DATE_TEXT.exec(text.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  return real ? `${match[1]}-${pad2(month)}-${pad2(day)}` : null;
}

/** "9:30" becomes "09:30". Null when the text is not a time on a 24-hour clock. */
export function parseTimeText(text: string): string | null {
  const match = TIME_TEXT.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${pad2(hour)}:${match[2]}`;
}

/**
 * The instant written the way the API wants it, on the wall clock of the given offset: "2026-10-12T15:30:00+05:30". The offset is
 * minutes east of UTC (India is +330, New York in winter -300).
 */
export function formatIsoWithOffset(instant: Date, offsetMinutes: number): string {
  const wall = new Date(instant.getTime() + offsetMinutes * MINUTE_MS);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${pad2(Math.floor(abs / MINUTES_PER_HOUR))}:${pad2(abs % MINUTES_PER_HOUR)}`;
  const day = `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())}`;
  const time = `${pad2(wall.getUTCHours())}:${pad2(wall.getUTCMinutes())}:${pad2(wall.getUTCSeconds())}`;
  return `${day}T${time}${offset}`;
}

/**
 * The due date the API takes for a day and a time typed on this phone: the phone's own wall clock and UTC offset on that day (so
 * daylight saving is the phone's). Null when either part is not valid.
 */
export function toDueAt(dateText: string, timeText: string): string | null {
  const day = parseDateText(dateText);
  const time = parseTimeText(timeText);
  if (!day || !time) return null;
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const local = new Date(year, month - 1, date, hour, minute, 0, 0);
  if (Number.isNaN(local.getTime())) return null;
  return formatIsoWithOffset(local, -local.getTimezoneOffset());
}

/** A stored due date as the day and time to put in the form's two fields, on this phone's clock. */
export function fromDueAt(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return { date: '', time: '' };
  return {
    date: `${instant.getFullYear()}-${pad2(instant.getMonth() + 1)}-${pad2(instant.getDate())}`,
    time: `${pad2(instant.getHours())}:${pad2(instant.getMinutes())}`,
  };
}

/** A moment for a row or a card: "12 Oct, 2026 03:30 PM". Empty when the text is not a date. */
export function formatMoment(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return '';
  const parts = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')}, ${part('year')} ${part('hour')}:${part('minute')} ${part('dayPeriod')}`.trim();
}
