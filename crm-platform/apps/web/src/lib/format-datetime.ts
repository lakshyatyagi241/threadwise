/**
 * The one date and date-time format of the app: the locale's "medium" date and "short" time ("Oct 8, 2026" and
 * "Oct 8, 2026, 5:14 PM" in English), read in the zone the person sees times in (their own, else the workspace's, else UTC:
 * `useTimeZone()` in a component; left out, the browser's zone). Screens must not compose their own variants, so lists, bubbles,
 * tooltips and the wallet all read the same. Empty for a missing or unparseable value.
 */
function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(
  value: string | number | Date | null | undefined,
  locale: string,
  timeZone?: string,
): string {
  const d = toDate(value);
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(d);
  } catch {
    return '';
  }
}

export function formatDateTime(
  value: string | number | Date | null | undefined,
  locale: string,
  timeZone?: string,
): string {
  const d = toDate(value);
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(d);
  } catch {
    return '';
  }
}
