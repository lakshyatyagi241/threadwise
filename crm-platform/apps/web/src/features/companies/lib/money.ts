import { currencyExponent, type MoneyTotal } from '@crm/contracts';

/**
 * One total in one currency, as the viewer reads it ("$1,250.00", "¥1,000"). The API sends exact decimal strings in the
 * currency's own units, so nothing is divided here (WaDesk divided every currency by 100). An unknown code falls back to
 * "CODE 1,250.00".
 */
export function formatTotal(total: MoneyTotal, locale: string): string {
  const exp = currencyExponent(total.currency);
  const n = Number(total.amount);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: total.currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(n);
  } catch {
    return `${total.currency} ${n.toLocaleString(locale, { minimumFractionDigits: exp, maximumFractionDigits: exp })}`;
  }
}

/** Every currency on its own line, never added together. Empty when there is nothing to show. */
export function formatTotals(
  totals: readonly MoneyTotal[] | null | undefined,
  locale: string,
): string[] {
  return (totals ?? []).map((t) => formatTotal(t, locale));
}
