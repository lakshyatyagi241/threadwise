import { currencyExponent, majorToMinor, minorToMajor, type MoneyTotal } from '@crm/contracts';
import { latinDigits } from '@/lib/format/numbers';

/**
 * Deal money. The API sends an amount as a decimal string in major units ("100.50") with the deal's own currency, and takes one
 * the same way. Nothing here adds or compares amounts: the server does the sums, per currency. The string becomes a number only to
 * be shown, and an amount is at most 99,999,999 with three decimals, which a number holds exactly.
 */

export interface MoneyOptions {
  /** 12.4K style, for a tight column header. */
  compact?: boolean;
}

/** "$1,250.00" in the viewer's language; a code the platform does not know falls back to "XYZ 1,250.00". */
export function formatMoney(
  amount: string,
  currency: string,
  language: string,
  options: MoneyOptions = {},
): string {
  const exponent = currencyExponent(currency);
  const major = Number(amount);
  if (!Number.isFinite(major)) return `${currency} ${amount}`;
  try {
    return new Intl.NumberFormat(latinDigits(language), {
      style: 'currency',
      currency,
      notation: options.compact ? 'compact' : 'standard',
      minimumFractionDigits: options.compact ? 0 : exponent,
      maximumFractionDigits: options.compact ? 1 : exponent,
    }).format(major);
  } catch {
    return `${currency} ${amount}`;
  }
}

/**
 * A sum the API reports per currency, as one line: "$1,250.00" for one currency, "$1,250.00 · €800.00" for several (never a mix
 * added together), and a dash when there is nothing to show.
 */
export function formatTotals(
  totals: readonly MoneyTotal[],
  language: string,
  options: MoneyOptions = {},
): string {
  const shown = totals.filter((total) => Number(total.amount) !== 0);
  if (shown.length === 0) return '—';
  return shown.map((t) => formatMoney(t.amount, t.currency, language, options)).join(' · ');
}

/** Codes offered in the currency picker; the pipeline's own is added when it is not among them. */
export const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'AED',
  'SAR',
  'INR',
  'EGP',
  'CAD',
  'AUD',
  'JPY',
] as const;

export const currencyChoices = (own: string): string[] => [...new Set([own, ...COMMON_CURRENCIES])];

/**
 * The amount as the API takes it, from what the person typed, or null when it is not an amount: blank is "0", a comma is a
 * thousands separator, and more decimals than the currency has (5000.5 yen, 1.005 dollars) is refused rather than rounded.
 * Over 99,999,999 is refused too. The answer carries the currency's own number of decimals ("100.50", "5000" for yen).
 */
export function amountFromInput(text: string, currency: string): string | null {
  const cleaned = text.trim().replace(/,/g, '');
  if (cleaned === '') return '0';
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null;
  const [whole = '', fraction = ''] = cleaned.split('.');
  const normal = `${whole === '' ? '0' : whole}${fraction ? `.${fraction}` : ''}`;
  const minor = majorToMinor(normal, currency);
  return minor === null ? null : minorToMajor(minor, currency);
}
