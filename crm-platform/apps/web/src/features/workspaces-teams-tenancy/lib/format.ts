/** "Oct 2, 2026": WaDesk's joined-date format, in the visitor's language. Null for a missing or unreadable date. */
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
