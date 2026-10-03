/** Small pure helpers the Facebook screens share. */

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "3 hours ago", "in 2 days": WaDesk's `diffForHumans`. Anything under a minute is "now". Empty when the time does not parse. */
export function relativeTime(iso: string | null | undefined, now: Date, locale = 'en'): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const diff = at - now.getTime();
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return fmt.format(Math.trunc(diff / ms), unit);
  }
  return fmt.format(0, 'second');
}

/** The first letter of a Page name, upper case, for an avatar chip; "FB" when there is no name. */
export const initial = (name: string | null | undefined): string =>
  Array.from((name ?? '').trim() || 'FB')[0]!.toUpperCase();

export const shorten = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/** A whole percent of a total; 0 when there is no total. */
export const sharePct = (n: number, total: number): number =>
  total > 0 ? Math.round((n / total) * 100) : 0;

/** Engagements over reach as a percent with one decimal; null unless both are known and non-zero (WaDesk). */
export function engagementRate(
  engagements: number | undefined,
  reach: number | undefined,
): number | null {
  if (!engagements || !reach) return null;
  return Math.round((engagements / Math.max(1, reach)) * 1000) / 10;
}

/** A count with thousands separators, or a dash when it is not known. */
export const formatCount = (n: number | null | undefined, locale = 'en'): string =>
  n === null || n === undefined ? '—' : n.toLocaleString(locale);

/** `YYYY-MM-DD` to a short axis label in the viewer's locale ("Oct 2"). */
export function dayLabel(day: string, locale = 'en'): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return day;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(t);
}

/** The rows of a mix (type or status) in a fixed order, only those present, each with its share of the whole mix. */
export function mixRows(
  mix: Record<string, number>,
  order: readonly string[],
): Array<{ key: string; n: number; pct: number }> {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  return order
    .filter((k) => (mix[k] ?? 0) > 0)
    .map((k) => ({ key: k, n: mix[k]!, pct: sharePct(mix[k]!, total) }));
}
