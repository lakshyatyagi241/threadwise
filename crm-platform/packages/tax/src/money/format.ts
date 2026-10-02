import { currencyExponent } from './currency';
import { formatScaled } from './decimal';

export interface FormatMoneyOptions {
  /** BCP 47 tag; default "en-US". Indian grouping (lakh/crore) comes from "en-IN". */
  locale?: string;
  /** "symbol" (default), "narrowSymbol", "code" or "name". */
  display?: 'symbol' | 'narrowSymbol' | 'code' | 'name';
  /** Hide ".00" on whole amounts (still shows the full exponent otherwise). */
  trimWholeDecimals?: boolean;
  signDisplay?: 'auto' | 'always' | 'never';
}

function manual(minor: bigint, currency: string): string {
  const exp = currencyExponent(currency);
  const neg = minor < 0n;
  const [w, f] = formatScaled(neg ? -minor : minor, exp, { keepZeros: true }).split('.');
  const grouped = w!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${currency.toUpperCase()} ${grouped}${f ? `.${f}` : ''}`;
}

/**
 * Formats a minor-unit amount for display: `formatMoney(1250050n, "INR", { locale: "en-IN" })` -> "₹12,500.50".
 * The exact decimal string goes to `Intl.NumberFormat` (no float), with the exponent pinned to ISO 4217 so JPY has 0 decimals and
 * KWD has 3. Falls back to a plain "CODE 1,234.50" where Intl is missing or rejects the locale/currency.
 * Display only: never parse this output back into money.
 */
export function formatMoney(
  minor: bigint,
  currency: string,
  opts: FormatMoneyOptions = {},
): string {
  const cur = currency.toUpperCase();
  const exp = currencyExponent(cur);
  try {
    if (typeof Intl === 'undefined' || typeof Intl.NumberFormat !== 'function')
      return manual(minor, cur);
    let digits = exp;
    if (opts.trimWholeDecimals && minor % 10n ** BigInt(exp) === 0n) digits = 0;
    const nf = new Intl.NumberFormat(opts.locale ?? 'en-US', {
      style: 'currency',
      currency: cur,
      currencyDisplay: opts.display ?? 'symbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: opts.signDisplay ?? 'auto',
    });
    return nf.format(formatScaled(minor, exp, { keepZeros: true }) as unknown as number);
  } catch {
    return manual(minor, cur);
  }
}

/** A grouped number from a scaled bigint, e.g. a quantity (scale 4) or a percentage. Trailing zeros are dropped. */
export function formatDecimalLocale(value: bigint, scale: number, locale = 'en-US'): string {
  try {
    const nf = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: scale,
    });
    return nf.format(formatScaled(value, scale) as unknown as number);
  } catch {
    return formatScaled(value, scale);
  }
}
