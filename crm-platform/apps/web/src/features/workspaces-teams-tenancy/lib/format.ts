/** "Oct 2, 2026": Reference's joined-date format, in the visitor's language. Null for a missing or unreadable date. */
export function joinedDate(iso: string | null, locale: string, timeZone?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(d);
}

/**
 * "Oct 2, 2026, 3:45 PM" in the workspace's time zone: when a member last signed in. Null for a missing or unreadable time.
 * A time zone the runtime does not know falls back to the visitor's own rather than throwing.
 */
export function dateTime(
  iso: string | null,
  locale: string,
  timeZone?: string | null,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: timeZone ?? undefined }).format(d);
  } catch {
    return new Intl.DateTimeFormat(locale, opts).format(d);
  }
}
