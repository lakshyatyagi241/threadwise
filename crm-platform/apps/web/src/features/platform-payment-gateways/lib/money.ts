/**
 * Display only: the API sends money as decimal strings and every calculation happens there. Number() is safe here because the
 * value is formatted, never added up or sent back.
 */
export function formatMoney(amount: string, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}
