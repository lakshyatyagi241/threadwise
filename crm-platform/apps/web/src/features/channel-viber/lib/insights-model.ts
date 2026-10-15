/** What the insights screen computes from the numbers (TW-VIB-016). Pure. */

/** Whole percent of `n` out of `d`; 0 with nothing to divide by. */
export const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 100) : 0);

/** The busiest day, never below 1, so a bar is a share of it and an empty week divides by one. */
export const peak = (rows: ReadonlyArray<{ in: number; out: number }>): number =>
  Math.max(1, ...rows.map((r) => r.in + r.out));

/** The two segments of a day's bar, each a whole percent of the busiest day (Reference), capped at 100. */
export function segments(
  row: { in: number; out: number },
  max: number,
): { in: number; out: number } {
  return {
    in: Math.min(100, Math.round((row.in / Math.max(1, max)) * 100)),
    out: Math.min(100, Math.round((row.out / Math.max(1, max)) * 100)),
  };
}
