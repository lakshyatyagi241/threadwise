/**
 * Money is a decimal STRING end to end (never a float on the wire or in the
 * model). These helpers compare and normalise without leaving integer cents.
 */

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export const isMoney = (value: string): boolean => MONEY.test(value);

/** "19" -> "19.00", "19.5" -> "19.50". Callers have checked `isMoney`. */
export function normaliseMoney(value: string): string {
  const [whole = '0', frac = ''] = value.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${(frac + '00').slice(0, 2)}`;
}

/** Integer minor units, for exact comparison. */
export function moneyCents(value: string): number {
  const [whole = '0', frac = ''] = normaliseMoney(value).split('.');
  return Number(whole) * 100 + Number(frac);
}

export const isZeroMoney = (value: string | null | undefined): boolean =>
  value == null || moneyCents(value) === 0;

/** Integer minor units back to a decimal string ("1999" -> "19.99"). */
export function centsToMoney(cents: number): string {
  const whole = Math.floor(cents / 100);
  return `${whole}.${String(cents % 100).padStart(2, '0')}`;
}
