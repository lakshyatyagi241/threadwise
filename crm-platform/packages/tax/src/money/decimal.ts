import { currencyExponent } from './currency';

/**
 * Exact decimal <-> scaled-integer conversion on strings. Never goes through `number`.
 */

/** "12.5" at scale 4 -> 125000n. Null when malformed or when a non-zero digit would fall past the scale. */
export function parseScaled(
  value: string,
  scale: number,
  opts: { allowNegative?: boolean } = {},
): bigint | null {
  const m = /^(-)?(\d{1,18})(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return null;
  if (m[1] && !opts.allowNegative) return null;
  const frac = m[3] ?? '';
  if (frac.length > scale && /[1-9]/.test(frac.slice(scale))) return null;
  const n = BigInt(m[2]! + (frac + '0'.repeat(scale)).slice(0, scale));
  return m[1] ? -n : n;
}

/** 125000n at scale 4 -> "12.5" (trailing zeros dropped) or, with `keepZeros`, "12.5000". */
export function formatScaled(n: bigint, scale: number, opts: { keepZeros?: boolean } = {}): string {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().padStart(scale + 1, '0');
  const whole = s.slice(0, s.length - scale);
  let frac = s.slice(s.length - scale);
  if (!opts.keepZeros) frac = frac.replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Quantities carry up to 4 decimals on the wire. */
export const QTY_SCALE = 4;
export const parseQty = (v: string): bigint | null => parseScaled(v, QTY_SCALE);
export const formatQty = (n: bigint): string => formatScaled(n, QTY_SCALE);

/** "100.50" + "USD" -> 10050n; null when it has more decimals than the currency allows (extra zeros are fine). */
export function parseMoney(
  value: string,
  currency: string,
  opts: { allowNegative?: boolean } = {},
): bigint | null {
  return parseScaled(value, currencyExponent(currency), opts);
}

/** 10050n + "USD" -> "100.50"; 1500n + "JPY" -> "1500"; 12500n + "KWD" -> "12.500". Always the full exponent. */
export function minorToMajorString(minor: bigint | number | string, currency: string): string {
  const n = typeof minor === 'bigint' ? minor : BigInt(minor);
  return formatScaled(n, currencyExponent(currency), { keepZeros: true });
}

// --- rates ---------------------------------------------------------------------------------------------------------------

/** Rates are carried as parts-per-million of one (18% = 180000) so 9.975% (Quebec QST) and 10.6667% are exact. */
export const RATE_DENOM = 1_000_000n;
/** A percent string has at most 4 decimals: 9.9750 -> 99750 ppm. */
export const RATE_PERCENT_SCALE = 4;

/** "18", "9.975", 18, "-10" -> ppm bigint; null when malformed or finer than 4 decimals of a percent. */
export function parseRate(value: string | number): bigint | null {
  const s = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value;
  if (/e/i.test(s)) return null;
  return parseScaled(s, RATE_PERCENT_SCALE, { allowNegative: true });
}

/** ppm -> "9.975" (percent, trailing zeros dropped). */
export function formatRate(ppm: bigint): string {
  return formatScaled(ppm, RATE_PERCENT_SCALE);
}

/** Basis points (1850) <-> percent string ("18.5"). Basis points carry at most 2 decimals of a percent. */
export const bpToPercent = (bp: number | bigint): string => formatScaled(BigInt(bp), 2);
/** "18.5" -> 1850. Fractional for finer rates (9.975% = 997.5 bp); null when malformed. */
export function percentToBp(percent: string | number): number | null {
  const ppm = parseRate(percent);
  if (ppm === null) return null;
  return Number(ppm) / 100;
}
