import {
  WALLET_CATEGORIES,
  normalizeWalletCategory,
  normalizeWalletCountry,
  type WalletCategory,
} from '@crm/contracts';

/**
 * Pure rules of the wallet module. Nothing here reads the database, the clock or the settings: the caller passes everything in,
 * so each rule has a plain unit test (the money paths are the ones that must fail loudly when the logic breaks).
 */

// --- the rate card (WD-WALLET-004) -------------------------------------------------------------------------------------------

/** One active row of `message_rates`. A blank country or category means "any". */
export interface RateCardRow {
  countryCode: string;
  category: string;
  /** Customer price per message, hundredths of the currency unit (0 = free). */
  priceMinor: number;
  /** Meta's wholesale cost, millionths of the currency unit; null = unknown. */
  metaCostMicros: number | null;
}

export interface Priced {
  priceMinor: number;
  metaCostMicros: number | null;
  /** Which row set the price (`IN|marketing`, `|`), or `flat` when the flat setting applied. */
  matched: string;
}

/**
 * Most specific row first: country+category, country (any category), any country with the category, the default row. The FIRST
 * row present wins even when its price is 0 (0 = deliberately free, e.g. service). The cost is the first row on that list that
 * CARRIES a cost: a row without one does not hide a cost further down, and none anywhere is `null` (unknown, not free).
 * With per-country pricing off the flat price is returned whatever the rows say, but the cost is still looked up so the
 * margin is known in flat mode (WaDesk rule 1).
 */
export function priceMessage(
  rows: readonly RateCardRow[],
  opts: {
    country: string | null | undefined;
    category: string | null | undefined;
    perCountryEnabled: boolean;
    flatPriceMinor: number;
  },
): Priced {
  const c = normalizeWalletCountry(opts.country);
  const k = normalizeWalletCategory(opts.category);
  const order: Array<[string, string]> = [
    [c, k],
    [c, ''],
    ['', k],
    ['', ''],
  ];
  const chain: RateCardRow[] = [];
  const seen = new Set<string>();
  for (const [cc, kk] of order) {
    const key = `${cc}|${kk}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = rows.find((r) => r.countryCode === cc && r.category === kk);
    if (row) chain.push(row);
  }
  const cost = chain.find((r) => r.metaCostMicros !== null)?.metaCostMicros ?? null;
  if (!opts.perCountryEnabled || chain.length === 0) {
    return { priceMinor: Math.max(0, opts.flatPriceMinor), metaCostMicros: cost, matched: 'flat' };
  }
  const first = chain[0]!;
  return {
    priceMinor: Math.max(0, first.priceMinor),
    metaCostMicros: cost,
    matched: `${first.countryCode}|${first.category}`,
  };
}

/** The panel of base prices (WD-WALLET-024): the any-country price of each category, or the selected country's. */
export function pricingTable(
  rows: readonly RateCardRow[],
  opts: { country: string | null; perCountryEnabled: boolean; flatPriceMinor: number },
): Array<{ category: WalletCategory; priceMinor: number; free: boolean }> {
  return WALLET_CATEGORIES.map((category) => {
    const { priceMinor } = priceMessage(rows, { ...opts, category });
    return { category, priceMinor, free: priceMinor <= 0 };
  });
}

// --- settlement (WD-WALLET-009, -010) ----------------------------------------------------------------------------------------

export type FreeReason = 'rate_is_zero' | 'within_plan_free_quota' | 'wallet_empty';

export type Settlement =
  | { outcome: 'free'; reason: FreeReason; shortfallMinor: number }
  | { outcome: 'charge'; chargedMinor: number; shortfallMinor: number };

export interface SettlementFacts {
  priceMinor: number;
  balanceMinor: number;
  /** Pay-per-message workspaces ignore the plan's allowance entirely. */
  payPerMessage: boolean;
  planActive: boolean;
  /** The plan's monthly messages; 0 = unlimited. */
  monthlyLimit: number;
  /** Messages already counted this month, BEFORE this one. */
  usedBefore: number;
}

/** Whether this message still fits the plan's free monthly allowance (WD-WALLET-010 rule 1). */
export function withinFreeQuota(
  f: Pick<SettlementFacts, 'planActive' | 'monthlyLimit' | 'usedBefore'>,
): boolean {
  if (!f.planActive) return false; // an ended plan or trial has no allowance at all
  if (f.monthlyLimit <= 0) return true; // unlimited
  return f.usedBefore + 1 <= f.monthlyLimit;
}

/**
 * Free or charged, and how much. A balance below the price is charged in part (the message already left: it is never
 * rejected), and the part not collected is the shortfall, recorded instead of silently lost. An empty wallet records the
 * message free with the whole price as shortfall (`wallet_empty`).
 */
export function decideSettlement(f: SettlementFacts): Settlement {
  const price = Math.max(0, Math.trunc(f.priceMinor));
  if (price === 0) return { outcome: 'free', reason: 'rate_is_zero', shortfallMinor: 0 };
  if (!f.payPerMessage && withinFreeQuota(f)) {
    return { outcome: 'free', reason: 'within_plan_free_quota', shortfallMinor: 0 };
  }
  const have = Math.max(0, Math.trunc(f.balanceMinor));
  const charged = Math.min(price, have);
  if (charged === 0) return { outcome: 'free', reason: 'wallet_empty', shortfallMinor: price };
  return { outcome: 'charge', chargedMinor: charged, shortfallMinor: price - charged };
}

/** A plan is active while its end (paid) or trial end (free) is in the future; no end at all never expires. */
export function planIsActive(
  plan: { planEndsAt: Date | null; trialEndsAt: Date | null },
  now: Date,
): boolean {
  if (plan.planEndsAt) return now < plan.planEndsAt;
  if (plan.trialEndsAt) return now < plan.trialEndsAt;
  return true;
}

/** First day of the UTC calendar month, as the `date` the usage counter is keyed by. */
export function monthStart(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// --- the launch gate (WD-WALLET-013) -----------------------------------------------------------------------------------------

export interface LaunchFacts {
  platformOwned: boolean;
  payPerMessage: boolean;
  planActive: boolean;
  monthlyLimit: number;
  usedThisMonth: number;
  recipients: number;
  balanceMinor: number;
  /** What `recipients` messages cost at the audience's prices, hundredths; null = cannot estimate. */
  estimateMinor: number | null;
  /** How much of the estimate the balance must cover before a launch is allowed, percent (0 = only "not empty"). */
  coveragePercent: number;
}

export type LaunchVerdict = { ok: true } | { ok: false; reason: 'empty' | 'insufficient' };

/**
 * Charging happens after delivery, so an empty wallet could otherwise blast a whole campaign for free. WaDesk blocked only on
 * a balance of 0 and compared nothing else (a 1-credit wallet launched 50,000 recipients). This keeps that rule and adds the
 * comparison WaDesk's own estimate was computed for and never used, with a configurable tolerance (coveragePercent).
 */
export function launchVerdict(f: LaunchFacts): LaunchVerdict {
  if (f.platformOwned) return { ok: true };
  if (!f.payPerMessage) {
    const fits =
      f.planActive &&
      (f.monthlyLimit <= 0 || f.usedThisMonth + Math.max(1, f.recipients) <= f.monthlyLimit);
    if (fits) return { ok: true };
  }
  if (f.balanceMinor <= 0) return { ok: false, reason: 'empty' };
  if (f.coveragePercent > 0 && f.estimateMinor !== null && f.estimateMinor > 0) {
    const needed = Math.ceil((f.estimateMinor * f.coveragePercent) / 100);
    if (f.balanceMinor < needed) return { ok: false, reason: 'insufficient' };
  }
  return { ok: true };
}

// --- low balance (WD-WALLET-015) ---------------------------------------------------------------------------------------------

export const LOW_BALANCE_THROTTLE_MS = 6 * 60 * 60 * 1000;

/**
 * Fires at or under the threshold, at most once per 6 hours. A top-up clears `alertedAt` (the wallet row), so a customer who tops
 * up and runs low again within the window is told again (WaDesk's throttle survived the top-up).
 */
export function shouldAlertLowBalance(
  balanceMinor: number,
  thresholdMinor: number,
  alertedAt: Date | null,
  now: Date,
): boolean {
  if (thresholdMinor <= 0 || balanceMinor > thresholdMinor) return false;
  return !alertedAt || now.getTime() - alertedAt.getTime() >= LOW_BALANCE_THROTTLE_MS;
}

// --- the statement (WD-WALLET-021, -022) -------------------------------------------------------------------------------------

/** A spreadsheet runs a cell that starts with one of these as a formula (WD-WALLET-022 rule 3). */
export function csvSafe(value: string | null | undefined): string {
  const v = value ?? '';
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function csvCell(value: string | number | null | undefined): string {
  const v = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Channel chip of a charge (WD-WALLET-021). */
export const CHANNEL_LABELS: Record<string, string> = {
  campaign: 'Campaign',
  broadcast: 'Broadcast',
  flow: 'Flow / Chatbot',
  scheduled: 'Scheduled',
  auto_reply: 'Auto-reply',
  chat: 'Team Inbox / Chat',
  inbox: 'Team Inbox / Chat',
  api: 'API',
};

export const ENGINE_LABELS: Record<string, string> = {
  waba: 'WhatsApp Cloud',
  baileys: 'WhatsApp',
  twilio: 'Twilio',
};

/** 12345 -> "123.45" with no float: the amounts are integers. */
export function formatMinor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const TYPE_LABELS: Record<string, string> = {
  topup: 'Top-up',
  earn: 'Earning',
  refund: 'Refund',
  spend: 'Message charge',
  admin_adjust: 'Adjustment',
};

export const CSV_HEADER = [
  'Date',
  'Type',
  'Description',
  'Channel',
  'Recipient',
  'Template',
  'Country',
  'Category',
  'Engine',
  'Money in',
  'Money out',
  'Balance after',
] as const;

/** The most rows one export carries: WaDesk had no cap and no rate limit (WD-WALLET-022 rule 5). */
export const CSV_MAX_ROWS = 50_000;

export function csvDate(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}
