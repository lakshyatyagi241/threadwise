export interface RelativeParts {
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * The largest unit that fits, negative for the past ("-3 minutes"). Anything
 * under ten seconds, and any moment that is in the future because the device
 * clock is ahead of the server's, reads as "now".
 */
export function relativeParts(thenMs: number, nowMs: number): RelativeParts {
  const seconds = Math.round((nowMs - thenMs) / 1000);
  if (seconds < 10) return { value: 0, unit: 'second' };
  if (seconds < MINUTE) return { value: -seconds, unit: 'second' };
  if (seconds < HOUR) return { value: -Math.floor(seconds / MINUTE), unit: 'minute' };
  if (seconds < DAY) return { value: -Math.floor(seconds / HOUR), unit: 'hour' };
  if (seconds < MONTH) return { value: -Math.floor(seconds / DAY), unit: 'day' };
  if (seconds < YEAR) return { value: -Math.floor(seconds / MONTH), unit: 'month' };
  return { value: -Math.floor(seconds / YEAR), unit: 'year' };
}

/** "3 minutes ago", "now", localized. */
export function formatRelative(then: string | number | Date, now: number, locale: string): string {
  const thenMs = new Date(then).getTime();
  if (Number.isNaN(thenMs)) return '';
  const { value, unit } = relativeParts(thenMs, now);
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, unit);
}
