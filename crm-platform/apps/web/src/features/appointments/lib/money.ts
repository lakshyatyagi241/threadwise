import { currencyExponent } from '@crm/contracts';

/**
 * A booking type's price on the client. Amounts are integer minor units (cents) in the type's own currency; the number of
 * decimals follows the currency (JPY 0, USD 2, KWD 3). Reference's form asks for minor units ("15000 = 150.00"); ours takes
 * the amount a person would write and converts exactly, with no floating point on the way in.
 */
export const exponentOf = (currency: string): number => currencyExponent(currency);

/** Largest fee the editor accepts, in minor units (keeps every product inside a safe integer). */
export const MAX_FEE_MINOR = 99_999_999_999;

/**
 * "12", "12.5", "1,234.50", "12,5" as minor units; null when it is not a non-negative amount. Extra decimals round half up
 * (12.345 becomes 12.35 in USD).
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
  if (minor > BigInt(MAX_FEE_MINOR)) return null;
  return Number(minor);
}

/** Minor units as an editable amount ("1250" USD becomes "12.50", JPY "1500" stays "1500"). */
export function minorToInput(minor: number, currency: string): string {
  const exp = exponentOf(currency);
  const abs = BigInt(Math.round(Math.abs(minor)))
    .toString()
    .padStart(exp + 1, '0');
  const body = exp === 0 ? abs : `${abs.slice(0, abs.length - exp)}.${abs.slice(abs.length - exp)}`;
  return minor < 0 ? `-${body}` : body;
}

/** "$150.00" for the locale; a code Intl does not know falls back to the code and a plain number. */
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

export interface PriceBreakdown {
  feeMinor: number;
  taxMinor: number;
  totalMinor: number;
  dueNowMinor: number;
}

/**
 * Fee, tax, total and what is due at booking, the way Reference's live summary and its server compute them: tax is
 * `round(fee x pct / 100)`, the total is fee plus tax, a full deposit asks for the total, a partial one for the stated
 * amount (never more than the total), none for nothing.
 */
export function priceBreakdown(
  feeMinor: number,
  taxPct: number,
  depositMode: 'none' | 'partial' | 'full',
  depositValueMinor: number,
): PriceBreakdown {
  const fee = Math.max(0, Math.round(feeMinor));
  const pct = Math.min(100, Math.max(0, taxPct));
  const taxMinor = Math.round((fee * pct) / 100);
  const totalMinor = fee + taxMinor;
  const dueNowMinor =
    depositMode === 'full'
      ? totalMinor
      : depositMode === 'partial'
        ? Math.min(totalMinor, Math.max(0, depositValueMinor))
        : 0;
  return { feeMinor: fee, taxMinor, totalMinor, dueNowMinor };
}

/** A tax percentage a person types ("18", "7.5", "7,5"); null when it is not a number from 0 to 100 with two decimals at most. */
export function parsePercent(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (s === '') return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : null;
}
