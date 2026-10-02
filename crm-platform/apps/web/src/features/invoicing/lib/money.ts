import { currencyExponent } from '@crm/contracts';

/**
 * Money on the client. Amounts are integer minor units in the document's own currency; the number of decimals follows the
 * currency (JPY 0, USD 2, KWD 3). Nothing here uses floating point to add or round money.
 */
export const exponentOf = (currency: string): number => currencyExponent(currency);

/** Largest single amount a box accepts, in minor units (keeps every product inside a safe integer). */
export const MAX_MINOR = 99_999_999_999;

/** `round(n / d)` for non-negative integers, halves away from zero. */
export function roundDiv(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

/**
 * What a person types in an amount box ("12", "12.5", "1,234.50", "12,5") as minor units, or null when it is not a
 * non-negative amount. Extra decimals round half up.
 */
export function parseMajor(text: string, currency: string): number | null {
  const exp = exponentOf(currency);
  let s = text.trim().replace(/\s/g, '');
  if (s === '') return null;
  if (s.includes(',') && !s.includes('.')) {
    const parts = s.split(',');
    s = parts.length === 2 && parts[1]!.length <= 2 ? `${parts[0]}.${parts[1]}` : parts.join('');
  } else s = s.replace(/,/g, '');
  const m = /^(\d{1,12})(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  const keep = frac.slice(0, exp).padEnd(exp, '0');
  let minor = BigInt(m[1]! + keep);
  if (frac.length > exp && frac.charCodeAt(exp) >= 53) minor += 1n;
  if (minor > BigInt(MAX_MINOR)) return null;
  return Number(minor);
}

/** Minor units as an editable amount ("1250" USD -> "12.50"; JPY "1500" -> "1500"). */
export function minorToInput(minor: number, currency: string): string {
  const exp = exponentOf(currency);
  const n = BigInt(Math.round(Math.abs(minor)));
  const abs = n.toString().padStart(exp + 1, '0');
  const body = exp === 0 ? abs : `${abs.slice(0, abs.length - exp)}.${abs.slice(abs.length - exp)}`;
  return minor < 0 ? `-${body}` : body;
}

/** `$1,250.00` for the locale; a code Intl does not know falls back to the code and a plain number. */
export function formatMoney(minor: number, currency: string, locale: string): string {
  const exp = exponentOf(currency);
  const major = minor / 10 ** exp;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(major);
  } catch {
    return `${currency.toUpperCase()} ${new Intl.NumberFormat(locale, {
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(major)}`;
  }
}

/** A percentage a person types ("18", "7.5") as basis points (750); null when it is not a number from 0 to 100. */
export function parsePercentToBp(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (s === '') return null;
  if (!/^\d{1,3}(\.\d*)?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 100 + 1e-9);
  return bp > 10_000 ? null : bp;
}

/** Basis points as an editable percentage (1850 -> "18.5", 1800 -> "18", 0 -> "0"). */
export const bpToInput = (bp: number): string => String(Math.round(bp) / 100);

/** `18` for 1800 bp, `7.5` for 750 bp: how a rate is printed ("Tax (18%)"). */
export const percentText = bpToInput;

/** Sum of amounts by currency, in the order each currency first appears. Totals of different currencies never mix. */
export function sumByCurrency<T>(
  rows: readonly T[],
  pick: (row: T) => { currency: string; minor: number },
): Array<{ currency: string; minor: number }> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const { currency, minor } = pick(r);
    out.set(currency, (out.get(currency) ?? 0) + minor);
  }
  return [...out].map(([currency, minor]) => ({ currency, minor }));
}
