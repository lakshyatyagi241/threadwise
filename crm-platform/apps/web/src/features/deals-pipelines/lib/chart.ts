/** Geometry helpers for the report charts. Pure. */

/** A round upper bound for an axis: 1, 2, 2.5, 5 or 10 times a power of ten that covers `max`. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= max) return m * base;
  return 10 * base;
}

/** `count + 1` evenly spaced tick values from 0 to `top`. */
export function ticks(top: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (top / count) * i);
}

/** Pixel length of a bar for `value` on a 0..`top` scale of `size` pixels; a non-zero value never vanishes. */
export function barLength(value: number, top: number, size: number): number {
  if (value <= 0 || top <= 0) return 0;
  return Math.max(2, Math.min(size, (value / top) * size));
}
