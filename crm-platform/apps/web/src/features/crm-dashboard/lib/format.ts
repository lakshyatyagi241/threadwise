import type { DealTotals } from '@crm/contracts';

/** Display helpers. Amounts arrive as decimal strings in major units; they are only ever formatted here, never summed. */

export function formatAmount(
  amount: string,
  currency: string,
  locale: string,
  opts: { compact?: boolean } = {},
): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: opts.compact ? 'compact' : 'standard',
      maximumFractionDigits: opts.compact ? 1 : undefined,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(locale)}`;
  }
}

export interface MoneyView {
  /** The one figure to show large: the converted total, else the only currency, else null (several currencies, no conversion). */
  primary: { amount: string; currency: string } | null;
  /** Every currency present, for the line under the figure when there is no single total. */
  parts: Array<{ amount: string; currency: string }>;
  /** Currencies the server could not convert (no exchange rate): the figure leaves them out and the page says so. */
  missing: string[];
}

export function moneyView(t: DealTotals): MoneyView {
  const parts = t.byCurrency.map((m) => ({ amount: m.amount, currency: m.currency }));
  const missing = t.unconverted ?? [];
  if (t.converted) return { primary: t.converted, parts, missing };
  if (parts.length === 1 && missing.length === 0) return { primary: parts[0]!, parts, missing };
  return { primary: null, parts, missing };
}

/** Magnitude for a chart or a bar: the converted figure, else the first currency, else 0. */
export function magnitude(t: DealTotals): number {
  const v = moneyView(t);
  const m = v.primary ?? v.parts[0];
  return m ? Number(m.amount) : 0;
}

/** Money with no total at all reads "0" in the converted currency, never blank. */
export function moneyText(
  t: DealTotals,
  locale: string,
  fallbackCurrency: string,
  opts: { compact?: boolean } = {},
): string {
  const v = moneyView(t);
  if (v.primary) return formatAmount(v.primary.amount, v.primary.currency, locale, opts);
  if (v.parts.length === 0) return formatAmount('0', fallbackCurrency, locale, opts);
  return v.parts.map((p) => formatAmount(p.amount, p.currency, locale, opts)).join(' + ');
}

/** Change against the previous window, in whole percent. Null when there was nothing before (a percentage of zero says nothing). */
export function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** `2026-10-13` as a short label in the viewer's language. The dates are calendar days, so they are formatted in UTC. */
export function dayLabel(ymd: string, locale: string, opts: { month?: boolean; year?: boolean } = {}): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      ...(opts.month ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }),
      ...(opts.year && !opts.month ? { year: 'numeric' } : {}),
    }).format(date);
  } catch {
    return ymd;
  }
}

/** Bars of the trend: the label of each bucket. */
export function bucketLabel(start: string, bucket: 'day' | 'week' | 'month', locale: string): string {
  return bucket === 'month' ? dayLabel(start, locale, { month: true }) : dayLabel(start, locale);
}
