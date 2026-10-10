/** Number helpers for figures and charts. Pure. */

/** 1,234 -> "1.2k", 1,500,000 -> "1.5M"; below a thousand the number as written. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  const trim = (v: number) => String(Math.round(v * 10) / 10);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(n / 1_000)}k`;
  return String(n);
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

/** A share of 0..100 for a progress bar, kept inside the bar whatever the data says. */
export const clampPercent = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;

/** `+12.5%`-style text for a change; the sign is shown for movement only. */
export function signed(n: number, unit: string): string {
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n)}${unit}`;
}

export type Direction = 'up' | 'down' | 'flat';
export const directionOf = (delta: number): Direction =>
  delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

/** Whether a move is good news. Fewer failures and a shorter queue are good. `null` when nothing moved. */
export function isGood(delta: number, lowerIsBetter = false): boolean | null {
  if (delta === 0) return null;
  return lowerIsBetter ? delta < 0 : delta > 0;
}
