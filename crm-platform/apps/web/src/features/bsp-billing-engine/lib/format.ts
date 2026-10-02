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

/** "01 Oct - 31 Oct": the P&L month window, in UTC like the API. `to` is exclusive, so the last day shown is the one before it. */
export function formatRange(from: string, to: string, locale: string): string {
  const day = new Intl.DateTimeFormat(locale, { day: '2-digit', timeZone: 'UTC' });
  const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const one = (d: Date) => `${day.format(d)} ${month.format(d)}`;
  return `${one(new Date(from))} - ${one(new Date(Date.parse(to) - 1))}`;
}
