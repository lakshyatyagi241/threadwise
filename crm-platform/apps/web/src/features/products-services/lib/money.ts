import { currencyExponent } from '@crm/contracts';

/** Largest unit price a box accepts, in minor units. */
export const MAX_MINOR = 99_999_999_999_999;

/**
 * What a person types in a price box ("12", "12.5", "1,234.50") as minor units in the currency, or null when it is not a non-negative
 * amount. The number of decimals follows the currency (JPY 0, USD 2, KWD 3); extra decimals round half up. No floating point.
 */
export function parsePrice(text: string, currency: string): number | null {
  const exp = currencyExponent(currency);
  const s = text.trim().replace(/\s/g, '').replace(/,/g, '');
  if (s === '') return null;
  const m = /^(\d{1,13})(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  const keep = frac.slice(0, exp).padEnd(exp, '0');
  let minor = BigInt(m[1]! + keep);
  if (frac.length > exp && frac.charCodeAt(exp) >= 53) minor += 1n;
  if (minor > BigInt(MAX_MINOR)) return null;
  return Number(minor);
}

/** Minor units as an editable amount ("1250" USD -> "12.50"). */
export function priceToInput(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const digits = BigInt(Math.round(Math.abs(minor)))
    .toString()
    .padStart(exp + 1, '0');
  return exp === 0
    ? digits
    : `${digits.slice(0, digits.length - exp)}.${digits.slice(digits.length - exp)}`;
}

/** `$1,250.00` for the locale; a code Intl does not know falls back to the code and a plain number. */
export function formatPrice(minor: number, currency: string, locale: string): string {
  const exp = currencyExponent(currency);
  const major = minor / 10 ** exp;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(major);
  } catch {
    return `${currency.toUpperCase()} ${major.toFixed(exp)}`;
  }
}

/** A tax percentage as a short text ("18", "12.5"), or '' for none. */
export const taxText = (percent: number | null): string =>
  percent === null ? '' : String(Number(percent.toFixed(4)));
