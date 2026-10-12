/**
 * Dates for the list and the thread. Words ("now", "yesterday", weekday names) come from Intl so they follow the locale
 * (Arabic included) without a message key each.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Local calendar day: the key of a day separator. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole calendar days between `iso` and now (0 = today, 1 = yesterday). */
export function daysAgo(iso: string, nowMs: number): number {
  return Math.round((startOfDay(nowMs) - startOfDay(Date.parse(iso))) / DAY);
}

/** "Today", "Yesterday", or "5 Jul 2026": the label of a day separator. */
export function dayLabel(iso: string, nowMs: number, locale: string): string {
  const n = daysAgo(iso, nowMs);
  if (n === 0 || n === 1) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-n, 'day');
  }
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The clock time of a bubble ("14:05"). */
export function clockTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** The list row's time: "now", "5 min. ago", the clock today, "yesterday", a weekday within a week, else the date. */
export function listTime(iso: string | null, nowMs: number, locale: string): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const diff = nowMs - at;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
  if (diff < 45_000) return rtf.format(0, 'second');
  if (diff < HOUR) return rtf.format(-Math.max(1, Math.round(diff / MIN)), 'minute');
  const days = daysAgo(iso, nowMs);
  if (days === 0) return clockTime(iso, locale);
  if (days === 1) return rtf.format(-1, 'day');
  if (days < 7) return new Date(at).toLocaleDateString(locale, { weekday: 'short' });
  return new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/** The full stamp in a tooltip ("5 Jul 2026, 14:05"). */
export function fullStamp(iso: string | null, locale: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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
export function exactStamp(iso: string | null, locale: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}
