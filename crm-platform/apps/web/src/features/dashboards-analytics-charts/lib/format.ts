/** Display helpers for the dashboard and analytics. Pure. */

/** 1,234 -> "1.2k", 1,500,000 -> "1.5M"; below a thousand the number as written (TW-DASH-004 rule 4). */
export function compact(n: number): string {
  const abs = Math.abs(n);
  const trim = (v: number) => String(Math.round(v * 10) / 10);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(n / 1_000)}k`;
  return String(n);
}

export type Direction = 'up' | 'down' | 'flat';
export const directionOf = (delta: number): Direction =>
  delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

/** Whether a move is good news. Fewer failures and a shorter queue are good (TW-DASH-023). */
export function isGood(delta: number, lowerIsBetter = false): boolean | null {
  if (delta === 0) return null;
  return lowerIsBetter ? delta < 0 : delta > 0;
}

/** The greeting in the workspace zone: before noon, before five, else evening (TW-DASH-001). */
export function greetingKey(now: Date, timezone: string): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now),
  );
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}

/** A round upper bound for an axis: 1, 2, 2.5, 5 or 10 times a power of ten that covers `max`. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= max) return m * base;
  return 10 * base;
}

/** Length of a bar for `value` on a 0..`top` scale of `size`; a non-zero value never vanishes. */
export function barLength(value: number, top: number, size: number): number {
  if (value <= 0 || top <= 0) return 0;
  return Math.max(2, Math.min(size, (value / top) * size));
}

/** Heatmap intensity 0..4 relative to the busiest cell (TW-DASH-031 port note: Reference's fixed counts never reached "peak"). */
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const r = value / max;
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}

/** `+12.5%`-style text for a delta; the sign is shown for movement only. */
export function signed(n: number, unit: string): string {
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n)}${unit}`;
}

/** Message-type buckets as shares of their sum (TW-DASH-027), one decimal. */
export function shares(
  rows: Array<{ key: string; count: number }>,
): Array<{ key: string; count: number; pct: number }> {
  const total = rows.reduce((a, r) => a + r.count, 0);
  return rows.map((r) => ({
    ...r,
    pct: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0,
  }));
}

/** An amount in a currency, grouped for the locale; a currency code the runtime does not know falls back to the code and the number. */
export function formatMoney(
  amount: string | number,
  currency: string,
  locale: string,
  digits = 2,
): string {
  const n = Number(amount);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(digits)}`;
  }
}

/** A delta string from the API ("31.25") as a signed number for the trend pill; anything unparsable is 0. */
export const deltaOf = (changePct: string): number => {
  const n = Number(changePct);
  return Number.isFinite(n) ? n : 0;
};

/** `<select>` value for a window the URL carried: unknown values read as the default, as the API does. */
export function pickOption<T extends string>(
  raw: string | undefined,
  options: readonly T[],
  fallback: T,
): T {
  return (options as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;
}

/** "3 hours", "12 minutes" style span between two instants, for the oldest-unread label and relative times. */
export function relativeSpan(from: string | Date, now: Date, locale: string): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(from).getTime()) / 60_000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'long' });
  const [value, unit] =
    mins < 60
      ? ([mins, 'minute'] as const)
      : mins < 1440
        ? ([Math.round(mins / 60), 'hour'] as const)
        : ([Math.round(mins / 1440), 'day'] as const);
  return rtf.format(-value, unit);
}

/** The dashboard export (TW-DASH-021): one row per chart bucket, quoted, with the same columns the chart draws. */
export function throughputCsv(
  rows: Array<{ label: string; sent: number; delivered: number; failed: number }>,
): string {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return [
    ['Period', 'Sent', 'Delivered', 'Failed'].map(q).join(','),
    ...rows.map((r) => [r.label, r.sent, r.delivered, r.failed].map(q).join(',')),
  ].join('\n');
}

/** Minutes as Reference writes them: under an hour "13m", else "2h 5m"; null is "-". */
export function minutesLabel(min: number | null): string {
  if (min === null) return '-';
  const m = Math.round(min);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Followers read as 1.2k from a thousand up (TW-DASH-008). */
export const followersLabel = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
