/**
 * Cost of scoring in USD. The API sends a decimal string (up to eight decimals): a score costs about 0.0001 USD, so the usual
 * two-decimal money format would print "$0.00" for work that was paid for. Small amounts keep their significant digits (down to the
 * eight decimals the ledger keeps), so the exact cost of one score is readable and a real cost never shows as zero.
 */
const SMALLEST = 0.0001;

const fmt = (locale: string, min: number, max: number) =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  });

export function formatCostUsd(value: string | number | null | undefined, locale = 'en'): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return '—';
  if (n === 0) return fmt(locale, 2, 2).format(0);
  if (n > 0 && n < SMALLEST) return fmt(locale, 4, 8).format(n);
  if (n < 0.01) return fmt(locale, 4, 6).format(n);
  if (n < 100) return fmt(locale, 2, 4).format(n);
  return fmt(locale, 2, 2).format(n);
}

export function formatCount(value: number, locale = 'en'): string {
  return new Intl.NumberFormat(locale).format(value);
}
