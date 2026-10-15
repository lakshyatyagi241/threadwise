/**
 * Money without floats. A Waboo amount is a JS number (a BSON double that was read as one) or a numeric string; it is turned into its
 * shortest exact decimal text (`0.1 + 0.2` stays `0.30000000000000004`, `1e-7` becomes `0.0000001`), and every later step is BigInt
 * arithmetic on that text. Nothing here ever multiplies or divides a float.
 */

export const SCALE = 18; // digits of fraction kept by `scaled` (a double has at most 17 significant digits)

const PLAIN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** The plain decimal text of a finite number or a numeric string (no exponent, no trailing zeros); null for anything else. */
export function plainDecimal(v: unknown): string | null {
  let s: string;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    s = String(v);
  } else if (typeof v === 'string') {
    s = v.trim();
    if (!PLAIN.test(s)) return null;
  } else return null;
  let neg = false;
  if (s[0] === '+' || s[0] === '-') {
    neg = s[0] === '-';
    s = s.slice(1);
  }
  let exp = 0;
  const e = s.search(/[eE]/);
  if (e >= 0) {
    exp = Number(s.slice(e + 1));
    s = s.slice(0, e);
    if (!Number.isSafeInteger(exp) || Math.abs(exp) > 400) return null;
  }
  const dot = s.indexOf('.');
  let digits = dot < 0 ? s : s.slice(0, dot) + s.slice(dot + 1);
  let point = (dot < 0 ? s.length : dot) + exp;
  if (point <= 0) {
    digits = '0'.repeat(1 - point) + digits;
    point = 1;
  } else if (point > digits.length) digits += '0'.repeat(point - digits.length);
  let int = digits.slice(0, point).replace(/^0+(?=\d)/, '');
  const frac = digits.slice(point).replace(/0+$/, '');
  if (int === '') int = '0';
  const zero = /^0*$/.test(int) && frac === '';
  return `${neg && !zero ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** value x 10^SCALE as a BigInt, truncated beyond SCALE digits (only the residual report uses it). */
export function scaled(plain: string): bigint {
  const neg = plain.startsWith('-');
  const [i, f = ''] = (neg ? plain.slice(1) : plain).split('.');
  const n = BigInt(i! + f.slice(0, SCALE).padEnd(SCALE, '0'));
  return neg ? -n : n;
}

/** Hundredths, rounded half away from zero on the decimal text (2.675 -> 2.68, exactly what the text says). */
export function toMinor(plain: string): bigint {
  const neg = plain.startsWith('-');
  const [i, f = ''] = (neg ? plain.slice(1) : plain).split('.');
  let n = BigInt(i! + f.slice(0, 2).padEnd(2, '0'));
  if (f.length > 2 && f.charCodeAt(2) >= 53) n += 1n; // third fraction digit >= 5
  return neg ? -n : n;
}

/** Hundredths as `-123.45`. */
export function minorText(m: bigint): string {
  const neg = m < 0n;
  const a = (neg ? -m : m).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${a.slice(0, -2)}.${a.slice(-2)}`;
}

/** Hundredths as the 4-decimal text numeric(20,4) prints. */
export function minorText4(m: bigint): string {
  return `${minorText(m)}00`;
}

/** SCALE-digit integer as a decimal text with at most `keep` fraction digits (trailing zeros trimmed). */
export function scaledText(s: bigint, keep = 12): string {
  const neg = s < 0n;
  const a = (neg ? -s : s).toString().padStart(SCALE + 1, '0');
  const int = a.slice(0, -SCALE);
  const frac = a.slice(-SCALE).slice(0, keep).replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** A whole, non-negative counter: an integer, an integral double or an integral numeric string. Null for anything else. */
export function counter(v: unknown): number | null {
  const p = plainDecimal(v);
  if (p === null || p.startsWith('-') || p.includes('.')) return null;
  const n = Number(p);
  return Number.isSafeInteger(n) ? n : null;
}

/** Hundredths from a value scaled by 10^SCALE, rounded half away from zero. */
export function minorOfScaled(s: bigint): bigint {
  const neg = s < 0n;
  const a = neg ? -s : s;
  const unit = 10n ** BigInt(SCALE - 2);
  let q = a / unit;
  if (a % unit >= unit / 2n) q += 1n;
  return neg ? -q : q;
}

/** a x b for two values scaled by 10^SCALE (truncated). */
export const mulScaled = (a: bigint, b: bigint): bigint => (a * b) / 10n ** BigInt(SCALE);
