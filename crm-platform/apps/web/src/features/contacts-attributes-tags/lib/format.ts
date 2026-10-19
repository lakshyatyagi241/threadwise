import { formatDate as sharedDate, formatDateTime as sharedDateTime } from '@/lib/format-datetime';

/** "05/03/2026": day/month/year with zeros, in `timeZone` (the viewer's when left out), whatever the UI language (the list's fixed format). */
export function formatDmy(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone,
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('day')}/${get('month')}/${get('year')}`;
  } catch {
    return '';
  }
}

/**
 * The app's one date-time ("Oct 1, 2026, 11:26 PM"), the same on the list, the tooltip, the contact page, the Inbox and the wallet
 * (see `@/lib/format-datetime`). Empty for a missing or unparseable value. `timeZone` defaults to the viewer's.
 */
export function formatDateTime(
  iso: string | null | undefined,
  locale: string,
  timeZone?: string,
): string {
  return sharedDateTime(iso, locale, timeZone);
}

/** The day only ("Oct 1, 2026"), for a table column too narrow for the time (the time is the cell's tooltip). */
export function formatDate(
  iso: string | null | undefined,
  locale: string,
  timeZone?: string,
): string {
  return sharedDate(iso, locale, timeZone);
}
