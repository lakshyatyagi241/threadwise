import { currencyExponent, minorToMajor, type DealTotals, type MoneyTotal } from '@crm/contracts';

/**
 * Sums and currency conversion for the board and the reports (WD-DEAL-005, 006, 019). Exact: sums are bigint minor units
 * per currency; a conversion is one bigint multiplication and one rounded division, never a float.
 *
 * WaDesk summed raw minor units across currencies and called the result one currency (reports), or converted per deal and
 * treated a missing or inactive rate as 1.0 (board). Here a missing rate is reported, not guessed.
 */

/** `currencies.exchange_rate` per code, scaled by 10^6: each rate is relative to one common base, so only ratios mean anything. */
export type RateTable = Map<string, bigint>;

const RATE_SCALE = 1_000_000n;

/** `"1.234567"` -> 1234567n. */
export function parseRate(raw: string | number): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(raw).trim());
  if (!m) return null;
  const frac = ((m[2] ?? '') + '000000').slice(0, 6);
  const scaled = BigInt(m[1]!) * RATE_SCALE + BigInt(frac);
  return scaled > 0n ? scaled : null;
}

export function rateTableOf(
  rows: Array<{ code: string; exchange_rate: string | number }>,
): RateTable {
  const table: RateTable = new Map();
  for (const r of rows) {
    const rate = parseRate(r.exchange_rate);
    if (rate !== null) table.set(r.code.toUpperCase(), rate);
  }
  return table;
}

/**
 * `minor` units of `from` expressed in minor units of `to`: amount / rate(from) * rate(to), rounded half up. Null when either
 * currency has no usable rate (the same currency always converts).
 */
export function convertMinor(
  minor: bigint,
  from: string,
  to: string,
  rates: RateTable,
): bigint | null {
  if (from === to) return minor;
  const rFrom = rates.get(from);
  const rTo = rates.get(to);
  if (!rFrom || !rTo) return null;
  const num = minor * rTo * 10n ** BigInt(currencyExponent(to));
  const den = rFrom * 10n ** BigInt(currencyExponent(from));
  return (2n * num + den) / (2n * den);
}

export type CurrencySums = Map<string, bigint>;

export function addTo(sums: CurrencySums, currency: string, minor: bigint): void {
  sums.set(currency, (sums.get(currency) ?? 0n) + minor);
}

export const bigOf = (v: string | number | bigint | null | undefined): bigint =>
  v == null ? 0n : BigInt(v);

/** value * probability / 100, rounded half up (a weighted forecast of one column). */
export const weightedMinor = (minor: bigint, probability: number): bigint =>
  (minor * BigInt(probability) * 2n + 100n) / 200n;

/** The per-currency list, sorted by currency code, zero totals kept only when asked (a column can legitimately hold 0.00). */
export function moneyList(sums: CurrencySums): MoneyTotal[] {
  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, minor]) => ({ currency, amount: minorToMajor(minor, currency) }));
}

/** The shape every total has on the wire: per currency, plus a converted figure when a target currency was asked for. */
export function totalsOf(
  sums: CurrencySums,
  convertTo: string | null,
  rates: RateTable,
): DealTotals {
  const byCurrency = moneyList(sums);
  if (!convertTo) return { byCurrency };
  let converted = 0n;
  const unconverted: string[] = [];
  for (const [currency, minor] of sums) {
    const c = convertMinor(minor, currency, convertTo, rates);
    if (c === null) unconverted.push(currency);
    else converted += c;
  }
  unconverted.sort();
  return {
    byCurrency,
    // A partial sum would read as the whole: with any currency unconvertible there is no converted figure.
    converted:
      unconverted.length === 0
        ? { currency: convertTo, amount: minorToMajor(converted, convertTo) }
        : null,
    unconverted,
  };
}

/** A single comparable number for ordering leaders, converted when possible else the first currency's raw amount. */
export function sortKey(sums: CurrencySums, convertTo: string | null, rates: RateTable): bigint {
  if (convertTo) {
    let total = 0n;
    for (const [currency, minor] of sums)
      total += convertMinor(minor, currency, convertTo, rates) ?? 0n;
    return total;
  }
  const first = [...sums.entries()].sort(([a], [b]) => a.localeCompare(b))[0];
  return first ? first[1] : 0n;
}
