/** Small display helpers for cards, the drawer and the timeline. Pure. */

/** One or two capital letters from a name ("Ana Lopez" -> "AL"); "?" for nothing usable. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]!][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? '') : '';
  return (first + last).toUpperCase();
}

const AVATAR_COLORS = ['#0f766e', '#7c3aed', '#c2410c', '#1d4ed8', '#be185d', '#4d7c0f'] as const;

/** The same name always gets the same colour. */
export function avatarColor(name: string | null | undefined): string {
  const text = name ?? '';
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export type DueState = 'overdue' | 'today' | 'upcoming';

/** Where a due date sits against `now`, by calendar day (a task due today is not overdue until tomorrow). */
export function dueState(
  dueAt: string | null | undefined,
  now: Date = new Date(),
): DueState | null {
  if (!dueAt) return null;
  // A date without a time ("2026-10-05") is a calendar day in the viewer's zone, not UTC midnight.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueAt);
  const due = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const a = day(due);
  const b = day(now);
  return a < b ? 'overdue' : a === b ? 'today' : 'upcoming';
}

/** Whole days between two instants, floored; used for "3d" ages. */
export function ageInDays(iso: string, now: Date = new Date()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/** Short age for a card: "today", "3d", "5w", "4mo", "2y". `labels` are translated by the caller. */
export function ageParts(
  iso: string,
  now: Date = new Date(),
): { unit: 'today' | 'd' | 'w' | 'mo' | 'y'; n: number } {
  const d = ageInDays(iso, now);
  if (d < 1) return { unit: 'today', n: 0 };
  if (d < 7) return { unit: 'd', n: d };
  if (d < 60) return { unit: 'w', n: Math.floor(d / 7) };
  if (d < 365) return { unit: 'mo', n: Math.floor(d / 30) };
  return { unit: 'y', n: Math.floor(d / 365) };
}

/** `YYYY-MM-DD` of a Date in the viewer's time zone (what a date input holds). */
export function toDateInput(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** A date-only value shown in the viewer's language without a time-zone shift. */
export function formatDay(
  value: string | null | undefined,
  locale: string,
  timeZone?: string,
): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    // A date-only value was built in local time above and must not shift; a full timestamp reads in the zone.
    timeZone: m ? undefined : timeZone,
  }).format(d);
}

export function formatDateTime(
  value: string | null | undefined,
  locale: string,
  timeZone?: string,
): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(d);
}

/** `2026-05` -> "May" (and the year when it differs from `ref`'s). */
export function monthLabel(month: string, locale: string, ref: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  const withYear = d.getFullYear() !== ref.getFullYear();
  return new Intl.DateTimeFormat(
    locale,
    withYear ? { month: 'short', year: '2-digit' } : { month: 'short' },
  ).format(d);
}
