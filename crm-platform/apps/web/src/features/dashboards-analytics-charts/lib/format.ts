/** Display helpers for the dashboard and analytics. Pure. */

/** 1,234 -> "1.2k", 1,500,000 -> "1.5M"; below a thousand the number as written (WD-DASH-004 rule 4). */
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

/** Whether a move is good news. Fewer failures and a shorter queue are good (WD-DASH-023). */
export function isGood(delta: number, lowerIsBetter = false): boolean | null {
  if (delta === 0) return null;
  return lowerIsBetter ? delta < 0 : delta > 0;
}

/** The greeting in the workspace zone: before noon, before five, else evening (WD-DASH-001). */
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

/** Heatmap intensity 0..4 relative to the busiest cell (WD-DASH-031 port note: WaDesk's fixed counts never reached "peak"). */
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const r = value / max;
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}

/** `+12.5%`-style text for a delta; the sign is shown for movement only. */
export function signed(n: number, unit: string): string {
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n)}${unit}`;
}

/** Message-type buckets as shares of their sum (WD-DASH-027), one decimal. */
export function shares(
  rows: Array<{ key: string; count: number }>,
): Array<{ key: string; count: number; pct: number }> {
  const total = rows.reduce((a, r) => a + r.count, 0);
  return rows.map((r) => ({
    ...r,
    pct: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0,
  }));
}
