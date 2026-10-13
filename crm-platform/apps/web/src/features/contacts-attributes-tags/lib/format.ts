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
 * "01 Oct 2026, 11:26 PM": day, short month, year, then the time. English is composed by hand so it reads the same in
 * every English locale (en-US would put the month first); other languages use their own medium date and short time.
 * Empty for a missing or unparseable value. `timeZone` defaults to the viewer's.
 */
export function formatDateTime(
  iso: string | null | undefined,
  locale: string,
  timeZone?: string,
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    if (/^en\b/i.test(locale)) {
      const parts = new Intl.DateTimeFormat('en-US', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone,
      }).formatToParts(d);
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
      return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
    }
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(d);
  } catch {
    return '';
  }
}
