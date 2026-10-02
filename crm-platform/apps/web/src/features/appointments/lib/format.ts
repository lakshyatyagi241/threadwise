import { parseDayKey } from './zone';

/** Small display helpers. Pure; every one is safe on an unreadable value (it gives an empty string). */

const valid = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

function fmt(
  d: Date,
  locale: string,
  zone: string | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone || undefined }).format(d);
  } catch {
    return '';
  }
}

/** "Mon 5 Oct" in `zone`. */
export function formatDay(iso: string | null | undefined, locale: string, zone?: string): string {
  const d = valid(iso);
  return d ? fmt(d, locale, zone, { weekday: 'short', day: 'numeric', month: 'short' }) : '';
}

/** "Monday, 5 October 2026". */
export function formatDayLong(
  iso: string | null | undefined,
  locale: string,
  zone?: string,
): string {
  const d = valid(iso);
  return d
    ? fmt(d, locale, zone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '';
}

/** "9:30 AM". */
export function formatTime(iso: string | null | undefined, locale: string, zone?: string): string {
  const d = valid(iso);
  return d ? fmt(d, locale, zone, { hour: 'numeric', minute: '2-digit' }) : '';
}

/** "9:30 AM – 10:00 AM". */
export function formatTimeRange(start: string, end: string, locale: string, zone?: string): string {
  const a = formatTime(start, locale, zone);
  const b = formatTime(end, locale, zone);
  return a && b ? `${a} – ${b}` : a;
}

/** "5 Oct 2026, 9:30 AM". */
export function formatDateTime(
  iso: string | null | undefined,
  locale: string,
  zone?: string,
): string {
  const d = valid(iso);
  return d
    ? fmt(d, locale, zone, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
}

/** The short zone name at the instant ("IST", "GMT+4", "PDT"); empty when unknown. */
export function zoneName(iso: string | null | undefined, locale: string, zone: string): string {
  const d = valid(iso);
  if (!d) return '';
  try {
    return (
      new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
        .formatToParts(d)
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    );
  } catch {
    return '';
  }
}

/** A calendar day (no zone: it is a date) formatted for a locale. */
export function formatDayKey(
  key: string,
  locale: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  const p = parseDayKey(key);
  if (!p) return '';
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(
      new Date(Date.UTC(p.year, p.month - 1, p.day, 12)),
    );
  } catch {
    return '';
  }
}

/** "October 2026". */
export const formatMonthYear = (key: string, locale: string): string =>
  formatDayKey(key, locale, { month: 'long', year: 'numeric' });

/** "5 Oct". */
export const formatShortDay = (key: string, locale: string): string =>
  formatDayKey(key, locale, { day: 'numeric', month: 'short' });

/** "Mon" / "M" for a weekday number, 0 = Sunday. */
export function weekdayLabel(
  weekday: number,
  locale: string,
  width: 'long' | 'short' | 'narrow' = 'short',
): string {
  try {
    // 3 January 2021 was a Sunday.
    return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' }).format(
      new Date(Date.UTC(2021, 0, 3 + weekday, 12)),
    );
  } catch {
    return '';
  }
}

/** The hour of a grid row, "9 AM" or "09:00" by the locale's habit. */
export function formatHour(hour: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2021, 0, 3, hour)),
    );
  } catch {
    return `${hour}:00`;
  }
}

/** One or two capital letters from a name; "?" for nothing usable. */
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

/** Hours and minutes of a duration, for "1 h 30 min" style labels. */
export function durationParts(minutes: number): { hours: number; minutes: number } {
  const m = Math.max(0, Math.round(minutes));
  return { hours: Math.floor(m / 60), minutes: m % 60 };
}

/** A colour that is safe as an inline style: a 6-digit hex, else the brand green. */
export function safeColor(color: string | null | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#075E54';
}

/** The text to show for a customer: their name, else phone, else email. */
export function customerLabel(c: {
  name: string | null;
  phone: string | null;
  email: string | null;
}): string {
  return c.name || c.phone || c.email || '';
}

/** The first day of the week in a locale, 0 = Sunday ... 6 = Saturday (Monday when the browser cannot say). */
export function firstWeekday(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    // ECMA-402 numbers the days 1 (Monday) to 7 (Sunday).
    if (info) return info.firstDay % 7;
  } catch {
    /* falls through */
  }
  return locale.startsWith('en') ? 0 : 1;
}
