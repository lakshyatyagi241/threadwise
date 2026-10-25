import {
  WALLET_COST_PLUS_KINDS,
  isUnlimitedLimit,
  WALLET_UNIT_PRICED_KINDS,
  type WalletCostPlusKind,
  type WalletReportedKind,
  type WalletUnitPricedKind,
} from '@crm/contracts';
import { AI_MARKUP_BPS, MIN_CHARGE_MINOR } from './wallet-rules';

/**
 * Pure rules of usage billing (everything that draws on the wallet besides a WhatsApp message). Nothing here reads the database or
 * the clock, so each rule has a plain unit test: the money paths are the ones that must fail loudly when the logic breaks.
 */

export interface UnitRate {
  enabled: boolean;
  /** Hundredths of the platform currency per unit; 0 = free. */
  priceMinor: number;
}

export interface UsageRates {
  prices: Record<WalletUnitPricedKind, UnitRate>;
  costPlus: Record<WalletCostPlusKind, { enabled: boolean }>;
  /** Markup on a vendor cost, basis points. */
  markupBps: number;
}

/**
 * SMS and email are never free: their rate cannot be switched off or set to 0, and a charge is at least the minimum (MIN_CHARGE_MINOR).
 * The rate on the pricing page sets the amount above that.
 */
const ALWAYS_CHARGED_KINDS: readonly string[] = ['sms', 'email'];

/**
 * What a fresh install charges, in hundredths of the platform currency (a WhatsApp message defaults to 1.00). An operator changes
 * every number on the pricing page. SMS and email are charged on top of the customer's own Twilio or mailbox bill: they are the
 * platform's fee for sending through the product. The other chat channels default to 0: tracked in the expense log, free until priced.
 */
export const USAGE_DEFAULTS: UsageRates = {
  prices: {
    sms: { enabled: true, priceMinor: 50 },
    email: { enabled: true, priceMinor: 15 },
    whatsapp_call: { enabled: true, priceMinor: 100 },
    voice_call: { enabled: true, priceMinor: 100 },
    enrichment: { enabled: true, priceMinor: 20 },
    chat_message: { enabled: true, priceMinor: 0 },
    // A website chatbot message beyond the plan's free allowance (`plans.limits.webbot_messages`).
    webbot_message: { enabled: true, priceMinor: 10 },
  },
  costPlus: { ai: { enabled: true }, translation: { enabled: true } },
  markupBps: AI_MARKUP_BPS,
};

export function isUnitPriced(kind: WalletReportedKind): kind is WalletUnitPricedKind {
  return (WALLET_UNIT_PRICED_KINDS as readonly string[]).includes(kind);
}

export function isCostPlus(kind: WalletReportedKind): kind is WalletCostPlusKind {
  return (WALLET_COST_PLUS_KINDS as readonly string[]).includes(kind);
}

/** The stored setting laid over the defaults: a missing or malformed value falls back, it never zeroes a price. */
export function mergeUsageRates(stored: unknown): UsageRates {
  const s = (typeof stored === 'object' && stored !== null ? stored : {}) as {
    prices?: Record<string, Partial<UnitRate> | undefined>;
    costPlus?: Record<string, { enabled?: unknown } | undefined>;
    markupBps?: unknown;
  };
  const prices = { ...USAGE_DEFAULTS.prices };
  for (const kind of WALLET_UNIT_PRICED_KINDS) {
    const row = s.prices?.[kind];
    const d = USAGE_DEFAULTS.prices[kind];
    prices[kind] = {
      enabled: typeof row?.enabled === 'boolean' ? row.enabled : d.enabled,
      priceMinor:
        typeof row?.priceMinor === 'number' &&
        Number.isInteger(row.priceMinor) &&
        row.priceMinor >= 0
          ? row.priceMinor
          : d.priceMinor,
    };
  }
  const costPlus = { ...USAGE_DEFAULTS.costPlus };
  for (const kind of WALLET_COST_PLUS_KINDS) {
    const row = s.costPlus?.[kind];
    costPlus[kind] = {
      enabled:
        typeof row?.enabled === 'boolean' ? row.enabled : USAGE_DEFAULTS.costPlus[kind].enabled,
    };
  }
  const markup = s.markupBps;
  return {
    prices,
    costPlus,
    markupBps:
      typeof markup === 'number' && Number.isInteger(markup) && markup >= 0
        ? markup
        : USAGE_DEFAULTS.markupBps,
  };
}

export type UsagePrice =
  /** A fixed price over `units`, in hundredths of the PLATFORM currency (the caller converts to the workspace's). */
  | { basis: 'unit'; platformMinor: number; unitMinor: number; units: number }
  /** A vendor cost in US dollars with the markup on it (the caller converts to the workspace's currency). */
  | { basis: 'cost_plus'; costUsd: number; chargeUsd: number; markupBps: number }
  /** Nothing to charge: the kind is off, the price is 0, there were no units or the vendor cost is unknown. */
  | { basis: 'none'; reason: 'switched_off' | 'price_is_zero' | 'no_units' | 'no_cost' };

/** The vendor's cost in USD with the markup: a call that cost us 1.00 at 2000 basis points is charged at 1.20. */
export const chargeUsdOf = (costUsd: number, markupBps: number): number =>
  costUsd > 0 ? costUsd * (1 + markupBps / 10_000) : 0;

/**
 * What one reported usage costs the customer. A unit-priced kind is `units x price`; a cost-plus kind is the vendor's cost plus
 * the markup. Zero units (a call nobody answered) and zero prices are free, never an error.
 */
export function priceUsage(
  rates: UsageRates,
  u: { kind: WalletReportedKind; units: number; vendorCostUsd?: number | null },
): UsagePrice {
  if (isUnitPriced(u.kind)) {
    const rate = rates.prices[u.kind];
    // SMS and email are always charged: a switched-off or zero rate cannot make them free, so the charge is at least the minimum.
    const alwaysCharged = ALWAYS_CHARGED_KINDS.includes(u.kind);
    if (!alwaysCharged && !rate.enabled) return { basis: 'none', reason: 'switched_off' };
    if (!alwaysCharged && rate.priceMinor <= 0) return { basis: 'none', reason: 'price_is_zero' };
    const unitMinor = alwaysCharged ? Math.max(MIN_CHARGE_MINOR, rate.priceMinor) : rate.priceMinor;
    const units = Math.max(0, Math.trunc(u.units));
    if (units === 0) return { basis: 'none', reason: 'no_units' };
    return {
      basis: 'unit',
      platformMinor: unitMinor * units,
      unitMinor,
      units,
    };
  }
  if (!rates.costPlus[u.kind as WalletCostPlusKind].enabled) {
    return { basis: 'none', reason: 'switched_off' };
  }
  const cost = u.vendorCostUsd ?? 0;
  if (!(cost > 0)) return { basis: 'none', reason: 'no_cost' };
  return {
    basis: 'cost_plus',
    costUsd: cost,
    chargeUsd: chargeUsdOf(cost, rates.markupBps),
    markupBps: rates.markupBps,
  };
}

/** The free reason a usage with no price is recorded under (the charge row's `free_reason` is a short fixed list). */
export const freeReasonOf = (_p: Extract<UsagePrice, { basis: 'none' }>): 'rate_is_zero' =>
  'rate_is_zero';

/** One line on the statement: `SMS`, `AI lead scoring`, `WhatsApp call · IN`. */
export const USAGE_KIND_LABELS: Record<WalletReportedKind, string> = {
  sms: 'SMS',
  email: 'Email',
  whatsapp_call: 'WhatsApp call',
  voice_call: 'Voice call',
  ai: 'AI',
  translation: 'Translation',
  enrichment: 'Contact lookup',
  chat_message: 'Chat message',
  webbot_message: 'Website chatbot message',
};

export function usageStatementLabel(
  kind: WalletReportedKind,
  label: string | null | undefined,
  country: string | null | undefined,
): string {
  const base = (label ?? '').trim() || USAGE_KIND_LABELS[kind];
  return country && !base.includes('·') ? `${base} · ${country}` : base;
}

/** Whole minutes a call is billed for: every started minute counts, an unanswered call (0 seconds) is free. */
export function billedMinutes(durationSeconds: number | null | undefined): number {
  const s = Math.trunc(Number(durationSeconds ?? 0));
  return s > 0 ? Math.ceil(s / 60) : 0;
}

/**
 * How many of `units` a plan's free allowance covers. The allowance is a number of messages per calendar month: `limit` of them are free,
 * counted in `usedBefore` (this month, before this usage), the rest are charged. An unlimited stand-in (0, or a million and up) and an ended
 * plan have NO allowance: like `monthly_messages`, a missing number charges every message instead of giving them away. The allowance is
 * the plan's promise, so it holds in every billing mode (the pay-per-message switch is about WhatsApp, where Meta bills the platform).
 */
export function freeUnitsOf(f: {
  units: number;
  usedBefore: number;
  limit: number;
  planActive: boolean;
}): number {
  const units = Math.max(0, Math.trunc(f.units));
  if (units === 0 || !f.planActive || isUnlimitedLimit(f.limit)) return 0;
  const left = Math.max(0, Math.trunc(f.limit) - Math.max(0, Math.trunc(f.usedBefore)));
  return Math.min(units, left);
}
