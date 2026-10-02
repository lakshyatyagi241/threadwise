/**
 * Integer rounding for `bigint` amounts. No float is involved anywhere in this package.
 *
 * Modes (all act on the exact quotient n / d):
 *  - `half_up`    nearest, a tie goes AWAY from zero (the usual "commercial" rounding; Reference's PHP `round`). Default.
 *  - `half_down`  nearest, a tie goes TOWARDS zero.
 *  - `half_even`  nearest, a tie goes to the even neighbour (banker's rounding; unbiased over many lines).
 *  - `up`         away from zero.   `down` towards zero (truncate).
 *  - `ceil`       towards +infinity. `floor` towards -infinity.
 */
export const ROUNDING_MODES = [
  'half_up',
  'half_down',
  'half_even',
  'up',
  'down',
  'ceil',
  'floor',
] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];
export const DEFAULT_ROUNDING_MODE: RoundingMode = 'half_up';

export function isRoundingMode(v: unknown): v is RoundingMode {
  return typeof v === 'string' && (ROUNDING_MODES as readonly string[]).includes(v);
}

export function absBig(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** n / d rounded to an integer by `mode`. `d` must not be zero; a negative `d` is normalised. */
export function divRound(n: bigint, d: bigint, mode: RoundingMode = DEFAULT_ROUNDING_MODE): bigint {
  if (d === 0n) throw new RangeError('division by zero');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const q = n / d; // truncates towards zero
  const r = n % d;
  if (r === 0n) return q;
  const sign = n < 0n ? -1n : 1n;
  switch (mode) {
    case 'down':
      return q;
    case 'up':
      return q + sign;
    case 'ceil':
      return sign > 0n ? q + 1n : q;
    case 'floor':
      return sign < 0n ? q - 1n : q;
    default: {
      const twice = 2n * absBig(r);
      if (twice > d) return q + sign;
      if (twice < d) return q;
      if (mode === 'half_up') return q + sign;
      if (mode === 'half_down') return q;
      return q % 2n === 0n ? q : q + sign; // half_even
    }
  }
}

/** Rounds `n` to a multiple of `step` (> 0): the cash-rounding primitive. */
export function roundToMultiple(
  n: bigint,
  step: bigint,
  mode: RoundingMode = DEFAULT_ROUNDING_MODE,
): bigint {
  if (step <= 0n) throw new RangeError('step must be positive');
  return divRound(n, step, mode) * step;
}

/**
 * Splits `total` over `weights` so the parts add back to `total` EXACTLY (largest remainder; a tie goes to the earlier
 * index). Weights must be non-negative; when they are all zero the result is all zeros (the caller decides what to do).
 * A negative total is allocated by magnitude and negated, so `allocate(-t, w)` is `-allocate(t, w)`.
 */
export function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  if (total < 0n) return allocate(-total, weights).map((x) => -x);
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (total === 0n || sum <= 0n) return weights.map(() => 0n);
  const base = weights.map((w) => (total * w) / sum);
  const rem = weights.map((w) => (total * w) % sum);
  let left = total - base.reduce((a, b) => a + b, 0n);
  const order = weights
    .map((_, i) => i)
    .sort((a, b) => (rem[b]! > rem[a]! ? 1 : rem[b]! < rem[a]! ? -1 : a - b));
  for (const i of order) {
    if (left === 0n) break;
    if (rem[i]! > 0n) {
      base[i] = base[i]! + 1n;
      left -= 1n;
    }
  }
  return base;
}
