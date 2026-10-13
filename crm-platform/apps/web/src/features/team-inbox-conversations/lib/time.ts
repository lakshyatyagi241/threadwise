/**
 * Dates for the list and the thread. Words ("now", "yesterday", weekday names) come from Intl so they follow the locale
 * (Arabic included) without a message key each.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Every function below takes the zone the person reads times in (their own, else the workspace's, else UTC: `useTimeZone()` in a
 * component). Left out, it is the browser's zone, which is what the tests and any caller without a session get.
 */

/** The calendar day of an instant in `timeZone`, as year, month (1-12) and day. */
export function dayParts(ms: number, timeZone?: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone,
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** How far `timeZone` is ahead of UTC at `ms`, in milliseconds. */
function offsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which the wall clock of `timeZone` reads `y-m-d h:min`. Days are `Date.UTC`-style (an overflowing day rolls into
 * the next month). Around a daylight-saving jump the clock time that does not exist is moved forward.
 */
export function zonedInstant(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  timeZone: string,
): number {
  const wall = Date.UTC(y, m - 1, d, h, min);
  let at = wall - offsetMs(wall, timeZone);
  at = wall - offsetMs(at, timeZone);
  return at;
}

/** The weekday (0 = Sunday) of the calendar day `ms` falls on in `timeZone`. */
export function weekdayIn(ms: number, timeZone: string): number {
  const { y, m, d } = dayParts(ms, timeZone);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The key of a day separator: the calendar day in `timeZone`. */
export function dayKey(iso: string, timeZone?: string): string {
  const { y, m, d } = dayParts(Date.parse(iso), timeZone);
  return `${y}-${m}-${d}`;
}

/** Whole calendar days between `iso` and now (0 = today, 1 = yesterday) on the calendar of `timeZone`. */
export function daysAgo(iso: string, nowMs: number, timeZone?: string): number {
  const a = dayParts(nowMs, timeZone);
  const b = dayParts(Date.parse(iso), timeZone);
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / DAY);
}

/** "Today", "Yesterday", or "5 Jul 2026": the label of a day separator. */
export function dayLabel(iso: string, nowMs: number, locale: string, timeZone?: string): string {
  const n = daysAgo(iso, nowMs, timeZone);
  if (n === 0 || n === 1) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-n, 'day');
  }
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  });
}

/** The clock time of a bubble ("14:05"). */
export function clockTime(iso: string, locale: string, timeZone?: string): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

/** The list row's time: "now", "5 min. ago", the clock today, "yesterday", a weekday within a week, else the date. */
export function listTime(
  iso: string | null,
  nowMs: number,
  locale: string,
  timeZone?: string,
): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const diff = nowMs - at;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
  if (diff < 45_000) return rtf.format(0, 'second');
  if (diff < HOUR) return rtf.format(-Math.max(1, Math.round(diff / MIN)), 'minute');
  const days = daysAgo(iso, nowMs, timeZone);
  if (days === 0) return clockTime(iso, locale, timeZone);
  if (days === 1) return rtf.format(-1, 'day');
  if (days < 7) return new Date(at).toLocaleDateString(locale, { weekday: 'short', timeZone });
  return new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone });
}

/** The full stamp in a tooltip ("5 Jul 2026, 14:05"). */
export function fullStamp(iso: string | null, locale: string, timeZone?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

/** `B`, `KB`, `MB`. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Two letters for an avatar. */
export function initials(name: string): string {
  // Words are cleaned of marks first, so "+91 98765" gives "91" and not "+9".
  const words = name
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]!][0] ?? '?';
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? '') : '';
  return (first + last).toUpperCase();
}

const AVATAR_COLORS = [
  'bg-emerald-600',
  'bg-sky-600',
  'bg-violet-600',
  'bg-amber-700',
  'bg-rose-600',
  'bg-teal-700',
  'bg-indigo-600',
  'bg-orange-700',
] as const;

/** The same person always gets the same colour. Whole class names so the style scanner finds them. */
export function avatarColor(id: string): (typeof AVATAR_COLORS)[number] {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** A moment to the second with its time zone: the delivery log's lines, where two steps can be a second apart. */
export function exactStamp(iso: string | null, locale: string, timeZone?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    timeZone,
  });
}
