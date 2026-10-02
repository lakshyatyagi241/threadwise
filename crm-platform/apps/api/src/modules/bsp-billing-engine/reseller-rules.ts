import {
  BSP_DEFAULT_BASE_CURRENCY,
  isCreditCurrency,
  normalizeCurrencyInput,
} from '@crm/contracts';

/**
 * Pure rules of the reseller module: nothing here reads the database or the clock (the caller passes `now`), so each one has a
 * plain unit test.
 */

// --- Meta wholesale cost (WD-BSP-016) --------------------------------------------------------------------------------------

export const RATE_CATEGORIES = ['marketing', 'utility', 'authentication', 'service'] as const;

/** One active row of `message_rates`. A blank country or category means "any". */
export interface RateRow {
  countryCode: string;
  category: string;
  credits: number;
  /** Minor units as the database's bigint text: no float ever carries money. */
  metaCostMinor: string | null;
}

/** The four categories Meta prices; anything else (including a missing one) falls to the any-category row (WD-BSP-016 rule 1). */
export function normalizeRateCategory(raw: string | null | undefined): string {
  const c = (raw ?? '').trim().toLowerCase();
  return (RATE_CATEGORIES as readonly string[]).includes(c) ? c : '';
}

export function normalizeCountry(raw: string | null | undefined): string {
  const c = (raw ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : '';
}

/**
 * Most specific row first: country+category, country with any category, any country with the category, the default row.
 * Both lookups follow it, but they differ on a gap: the price is the first matching row's, while the cost is the first row that
 * CARRIES a cost. A row without a cost does not hide a cost further down the list, and no cost anywhere is `null` (unknown),
 * which is not 0 (free): the dashboard counts an unknown cost as unpriced.
 */
export function resolveRate(
  rows: readonly RateRow[],
  country: string | null | undefined,
  category: string | null | undefined,
): { credits: number | null; costMinor: string | null } {
  const c = normalizeCountry(country);
  const k = normalizeRateCategory(category);
  const order: Array<[string, string]> = [
    [c, k],
    [c, ''],
    ['', k],
    ['', ''],
  ];
  const chain: RateRow[] = [];
  const seen = new Set<string>();
  for (const [cc, kk] of order) {
    const key = `${cc}|${kk}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = rows.find((r) => r.countryCode === cc && r.category === kk);
    if (row) chain.push(row);
  }
  return {
    credits: chain[0]?.credits ?? null,
    costMinor: chain.find((r) => r.metaCostMinor !== null)?.metaCostMinor ?? null,
  };
}

// --- who is billed for messages (WD-BSP-012 rule 1) -------------------------------------------------------------------------

/** A reseller workspace is always wallet billed; any other follows the platform-wide switch. */
export function isPayPerMessage(billToPlatformCredit: boolean, platformSwitch: boolean): boolean {
  return billToPlatformCredit || platformSwitch;
}

// --- credit line currency (WD-BSP-006, -007, -011) ---------------------------------------------------------------------------

/**
 * The currency a credit line is attached in. An explicit choice wins. Otherwise the candidates are tried in order and the first
 * one Meta accepts is used; the credit line's currency is locked once attached, so a currency Meta would refuse is skipped rather
 * than recorded as a failure while a usable one exists.
 */
export function pickAttachCurrency(
  explicit: string | null | undefined,
  candidates: ReadonlyArray<string | null | undefined>,
): string {
  const e = normalizeCurrencyInput(explicit);
  if (e) return e;
  for (const raw of candidates) {
    const c = normalizeCurrencyInput(raw);
    if (c && isCreditCurrency(c)) return c;
  }
  const first = candidates.map((c) => normalizeCurrencyInput(c)).find(Boolean);
  return first ?? BSP_DEFAULT_BASE_CURRENCY;
}

/** Why a currency cannot be attached, or null when Meta accepts it. */
export function currencyProblem(currency: string, allowed: readonly string[]): string | null {
  return isCreditCurrency(currency)
    ? null
    : `Meta accepts only ${allowed.join(', ')} for a credit line and the currency cannot be changed after attaching (got ${currency || 'none'}).`;
}

// --- the P&L window (WD-BSP-014) ---------------------------------------------------------------------------------------------

export interface MonthWindow {
  month: string;
  from: Date;
  /** Exclusive. */
  to: Date;
}

/** `YYYY-MM` (or the month `now` falls in) as the half-open UTC interval the dashboard sums over. */
export function monthWindow(month: string | undefined, now: Date): MonthWindow {
  const label =
    month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const [y, m] = label.split('-').map(Number) as [number, number];
  return { month: label, from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

/** Last characters of a WABA id as the register shows them: "..." plus the tail. */
export function wabaTail(wabaId: string, n: number): string {
  return `...${wabaId.slice(-n)}`;
}

// --- decimal money (WD-BSP-014) ------------------------------------------------------------------------------------------------

/**
 * `a - b` for two decimal strings of the same scale ("100.00" - "72.00" = "28.00"), through BigInt so no float touches an amount.
 * The database already divided both by the same exponent, so the scales match.
 */
export function subtractDecimal(a: string, b: string): string {
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const toInt = (v: string): bigint => {
    const neg = v.startsWith('-');
    const [whole = '0', frac = ''] = v.replace('-', '').split('.');
    const n = BigInt(whole + frac.padEnd(scale, '0'));
    return neg ? -n : n;
  };
  const diff = toInt(a) - toInt(b);
  const neg = diff < 0n;
  const digits = (neg ? -diff : diff).toString().padStart(scale + 1, '0');
  const body = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return neg ? `-${body}` : body;
}
