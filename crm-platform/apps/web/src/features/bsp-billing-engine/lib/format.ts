/**
 * Money arrives as a decimal string in the base currency's major unit ("100.00"). Intl formats the string itself, so no float
 * ever holds an amount; a currency code the browser does not know falls back to the code and the digits.
 */
export function formatMoney(amount: string, currency: string, locale: string): string {
  const fractionDigits = amount.includes('.') ? amount.split('.')[1]!.length : 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      // Intl accepts a decimal string and formats it exactly (ES2023 string numeric literals).
    }).format(amount as unknown as number);
  } catch {
    return `${currency} ${amount}`;
  }
}

/** The last `n` characters of a WABA id with an ellipsis, as the register shows them. */
export function wabaTail(wabaId: string, n = 6): string {
  return wabaId.length <= n ? wabaId : `…${wabaId.slice(-n)}`;
}

/** `YYYY-MM` for a date, in UTC (the API cuts months in UTC). */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The current month and the eleven before it, newest first, each with a label in the person's language. */
export function monthOptions(now: Date, locale: string, count = 12): Array<{ value: string; label: string }> {
  const fmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return { value: monthKey(d), label: fmt.format(d) };
  });
}
