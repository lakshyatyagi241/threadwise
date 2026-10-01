import { z } from 'zod';

/**
 * Deal money (WD-DEAL-006). A deal stores integer minor units plus its own ISO 4217 currency code; on the wire the amount is a
 * decimal STRING in major units ("100.50"), never a float. WaDesk always showed two decimals whatever the currency and let the
 * currency be any ten characters; here the number of decimals follows the currency and the code must be three letters.
 */

/** Largest value a deal can carry, in major units (WaDesk: `max:99999999`). */
export const DEAL_VALUE_MAX_MAJOR = 99_999_999;

/** Currencies that have no minor unit, or three decimals, per ISO 4217. Everything else has two. */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/** Digits after the decimal point for a currency. */
export function currencyExponent(code: string): number {
  const c = code.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/** `"100.5"` or `"100"`, at most three decimals typed; the currency decides how many it may keep. */
export const dealValueSchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,3})?$/, 'value must be a non-negative decimal such as "100.50"');

/** Upper-cased, three letters. */
export const currencyCodeSchema = z
  .string()
  .trim()
  .length(3)
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z]{3}$/.test(v), 'currency must be a 3-letter ISO code');

/**
 * `"100.50"` + `"USD"` -> 10050n. Null when the string has more decimals than the currency allows or is above the cap.
 * Exact: no float is involved.
 */
export function majorToMinor(value: string, currency: string): bigint | null {
  const exp = currencyExponent(currency);
  const m = /^(\d{1,9})(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return null;
  const whole = m[1]!;
  const frac = m[2] ?? '';
  if (frac.length > exp) {
    // "100.50" for a zero-decimal currency is fine only when the extra digits are zeros.
    if (/[1-9]/.test(frac.slice(exp))) return null;
  }
  const padded = (frac + '0'.repeat(exp)).slice(0, exp);
  const minor = BigInt(whole + padded);
  if (minor > BigInt(DEAL_VALUE_MAX_MAJOR) * 10n ** BigInt(exp)) return null;
  return minor;
}

/** 10050n + "USD" -> "100.50". */
export function minorToMajor(minor: bigint | number | string, currency: string): string {
  const exp = currencyExponent(currency);
  const n = typeof minor === 'bigint' ? minor : BigInt(minor);
  const neg = n < 0n;
  const abs = (neg ? -n : n).toString().padStart(exp + 1, '0');
  const whole = exp === 0 ? abs : abs.slice(0, abs.length - exp);
  const frac = exp === 0 ? '' : abs.slice(abs.length - exp);
  return `${neg ? '-' : ''}${whole}${exp === 0 ? '' : `.${frac}`}`;
}

/** One total in one currency. A list of these is how a sum over mixed currencies is reported without lying. */
export const moneyTotalSchema = z.object({
  currency: z.string(),
  amount: z.string(),
});
export type MoneyTotal = z.infer<typeof moneyTotalSchema>;
