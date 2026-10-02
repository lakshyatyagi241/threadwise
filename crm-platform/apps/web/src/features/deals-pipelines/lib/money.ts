import { currencyExponent } from '@crm/contracts';

/** Integer minor units <-> major decimals, display and the weighted value. Pure, no React. */

/** Digits after the decimal point for a currency (JPY 0, USD 2, KWD 3): the contract's rule, shared with the API. */
export const minorExponent = (currency: string): number => currencyExponent(currency);

/**
 * "250.5" -> 25050. Blank is 0; garbage, a negative number, or more decimals than the currency has (JPY 5000.5, USD 1.005)
 * is NaN so the form can say so: the API refuses those too, and an amount is never rounded behind the person's back.
 */
export function toMinor(input: string | number, currency: string): number {
  const text = typeof input === 'number' ? String(input) : input.trim().replace(/,/g, '');
  if (text === '') return 0;
  if (!/^\d*\.?\d*$/.test(text) || text === '.') return Number.NaN;
  const exp = minorExponent(currency);
  const fraction = text.split('.')[1] ?? '';
  if (fraction.length > exp && /[1-9]/.test(fraction.slice(exp))) return Number.NaN;
  return Math.round(Number(text) * 10 ** exp);
}

/** 25050 -> "250.50" for an input field (plain number, no grouping). */
export function toMajorInput(minor: number, currency: string): string {
  const exp = minorExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

export interface MoneyOptions {
  /** 12.4K style, used in tight column headers. */
  compact?: boolean;
}

/** "$1,250.00" in the viewer's language; an unknown currency code falls back to "CODE 1,250.00". */
export function formatMoney(
  minor: number,
  currency: string,
  locale: string,
  opts: MoneyOptions = {},
): string {
  const exp = minorExponent(currency);
  const major = minor / 10 ** exp;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: opts.compact ? 'compact' : 'standard',
      minimumFractionDigits: opts.compact ? 0 : exp,
      maximumFractionDigits: opts.compact ? 1 : exp,
    }).format(major);
  } catch {
    return `${currency} ${major.toLocaleString(locale)}`;
  }
}

/** Probability-weighted value, rounded half away from zero (the spec's rule for forecasts). */
export function weighted(minor: number, probability: number): number {
  const raw = (minor * probability) / 100;
  return raw < 0 ? -Math.round(-raw) : Math.round(raw);
}

export const sumMinor = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** Codes offered in the currency pickers; a pipeline's own currency is added when it is not among them. */
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'INR', 'EGP', 'CAD', 'AUD', 'JPY'] as const;

export const currencyChoices = (own: string): string[] => [
  ...new Set([own, ...COMMON_CURRENCIES]),
];
