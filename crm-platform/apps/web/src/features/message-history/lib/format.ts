/** Formatting the screen does without a component: durations, money, and the "today / yesterday / Oct 3" label of a row. */

/** Seconds as `45s`, `3m 20s` or `1h 5m` (Reference's), in the unit names of the locale. */
export function humanDuration(seconds: number | null, locale: string): string {
  if (seconds === null) return '—';
  const part = (n: number, unit: 'hour' | 'minute' | 'second') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(n);
  if (seconds < 60) return part(seconds, 'second');
  if (seconds < 3600) {
    return `${part(Math.floor(seconds / 60), 'minute')} ${part(seconds % 60, 'second')}`;
  }
  return `${part(Math.floor(seconds / 3600), 'hour')} ${part(Math.floor((seconds % 3600) / 60), 'minute')}`;
}

/** An amount in hundredths of a currency. A code `Intl` does not know (or none) is shown as a plain number. */
export function formatMinor(minor: number, currency: string | null, locale: string): string {
  const value = minor / 100;
  if (currency && /^[A-Za-z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency.toUpperCase(),
      }).format(value);
    } catch {
      // not a currency Intl knows: the plain number below
    }
  }
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export const formatCount = (n: number, locale: string): string =>
  new Intl.NumberFormat(locale).format(n);

const dayKey = (d: Date, tz: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

/** "today", "yesterday" or "Oct 3": the date line under the time of a row (Reference's `humanDate`). */
export function dayLabel(iso: string, now: Date, locale: string, tz: string): string {
  const d = new Date(iso);
  const k = dayKey(d, tz);
  const rel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (k === dayKey(now, tz)) return rel.format(0, 'day');
  if (k === dayKey(new Date(now.getTime() - 86_400_000), tz)) return rel.format(-1, 'day');
  return new Intl.DateTimeFormat(locale, { timeZone: tz, month: 'short', day: 'numeric' }).format(
    d,
  );
}

export const timeLabel = (iso: string, locale: string, tz: string): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

export const fullStamp = (iso: string, locale: string, tz: string): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(iso));

/** Label of a volume bucket: the weekday for up to a week of days, `Oct 3` for more, `14:00` for hours. */
export function bucketLabel(
  iso: string,
  bucket: 'hourly' | 'daily' | 'weekly',
  days: number,
  locale: string,
  tz: string,
): string {
  const d = new Date(iso);
  if (bucket === 'hourly') return timeLabel(iso, locale, tz);
  if (bucket === 'daily' && days <= 7) {
    return new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short' }).format(d);
  }
  return new Intl.DateTimeFormat(locale, { timeZone: tz, month: 'short', day: 'numeric' }).format(
    d,
  );
}

/** Initials of a name for the avatar circle: first letters of the first and last word. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  const first = Array.from(parts[0]!)[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : '';
  return `${first}${last}`.toUpperCase() || '··';
}
