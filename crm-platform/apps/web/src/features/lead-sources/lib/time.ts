const STEPS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'year', ms: 365 * 86_400_000 },
  { unit: 'month', ms: 30 * 86_400_000 },
  { unit: 'day', ms: 86_400_000 },
  { unit: 'hour', ms: 3_600_000 },
  { unit: 'minute', ms: 60_000 },
];

/** "3 days ago", "yesterday", "this minute" for an instant, in the viewer's language; '' when it is unreadable. */
export function relativeTime(iso: string | null | undefined, now: Date, locale: string): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const diff = at - now.getTime();
  try {
    const f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    for (const s of STEPS) {
      if (Math.abs(diff) >= s.ms) return f.format(Math.round(diff / s.ms), s.unit);
    }
    return f.format(0, 'minute');
  } catch {
    return '';
  }
}
