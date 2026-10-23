import {
  WALLET_COST_PLUS_KINDS,
  WALLET_UNIT_PRICED_KINDS,
  WALLET_USAGE_LIMITS,
  updateWalletUsageSettingsSchema,
  walletMinorToMajor,
  type UpdateWalletUsageSettingsInput,
  type WalletCostPlusKind,
  type WalletUnitPricedKind,
  type WalletUsageSettings,
} from '@crm/contracts';
import { parseAmount } from './money';

/** One unit-priced kind in the form: its switch and its price as typed ("0.50"). */
export interface UsagePriceDraft {
  enabled: boolean;
  price: string;
}

export interface UsageRatesDraft {
  prices: Record<WalletUnitPricedKind, UsagePriceDraft>;
  costPlus: Record<WalletCostPlusKind, boolean>;
  /** The markup on a vendor cost as a percentage as typed ("10", "12.5"). */
  markupPercent: string;
}

export type UsageRatesProblem = 'invalid' | 'tooHigh';
export interface UsageRatesProblems {
  prices: Partial<Record<WalletUnitPricedKind, UsageRatesProblem>>;
  markup?: UsageRatesProblem;
}

/** Basis points as a percentage without a trailing zero: 1000 -> "10", 1250 -> "12.5". */
export const bpsToPercent = (bps: number): string => String(Math.round(bps) / 100);

/** A percentage typed by a person ("10", "12.5", "12.55") to basis points; null when it is not a plain non-negative percentage. */
export function percentToBps(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
  const bps = Math.round(Number(t) * 100);
  return Number.isSafeInteger(bps) ? bps : null;
}

export function toUsageDraft(s: WalletUsageSettings): UsageRatesDraft {
  const prices = {} as UsageRatesDraft['prices'];
  for (const kind of WALLET_UNIT_PRICED_KINDS) {
    const row = s.prices.find((p) => p.kind === kind);
    prices[kind] = {
      enabled: row?.enabled ?? true,
      price: walletMinorToMajor(row?.priceMinor ?? 0),
    };
  }
  const costPlus = {} as UsageRatesDraft['costPlus'];
  for (const kind of WALLET_COST_PLUS_KINDS) {
    costPlus[kind] = s.costPlus.find((c) => c.kind === kind)?.enabled ?? true;
  }
  return { prices, costPlus, markupPercent: bpsToPercent(s.markupBps) };
}

export interface UsageRatesCheck {
  input: UpdateWalletUsageSettingsInput | null;
  problems: UsageRatesProblems;
}

/** Checks the prices form with the contract's schema; money stays text. The server is still the authority. */
export function checkUsageRates(d: UsageRatesDraft): UsageRatesCheck {
  const problems: UsageRatesProblems = { prices: {} };
  for (const kind of WALLET_UNIT_PRICED_KINDS) {
    const minor = parseAmount(d.prices[kind].price);
    if (minor === null) problems.prices[kind] = 'invalid';
    else if (minor > WALLET_USAGE_LIMITS.maxPriceMinor) problems.prices[kind] = 'tooHigh';
  }
  const bps = percentToBps(d.markupPercent);
  if (bps === null) problems.markup = 'invalid';
  else if (bps > WALLET_USAGE_LIMITS.maxMarkupBps) problems.markup = 'tooHigh';

  const parsed = updateWalletUsageSettingsSchema.safeParse({
    prices: WALLET_UNIT_PRICED_KINDS.map((kind) => ({
      kind,
      enabled: d.prices[kind].enabled,
      price: d.prices[kind].price.trim(),
    })),
    costPlus: WALLET_COST_PLUS_KINDS.map((kind) => ({ kind, enabled: d.costPlus[kind] })),
    markupBps: bps ?? 0,
  });
  const clean = Object.keys(problems.prices).length === 0 && !problems.markup;
  return { input: clean && parsed.success ? parsed.data : null, problems };
}

/** Whether the form differs from what is saved. */
export function usageRatesDirty(d: UsageRatesDraft, s: WalletUsageSettings): boolean {
  const saved = toUsageDraft(s);
  const norm = (x: UsageRatesDraft): string =>
    JSON.stringify({
      prices: WALLET_UNIT_PRICED_KINDS.map((k) => [
        k,
        x.prices[k].enabled,
        parseAmount(x.prices[k].price) ?? x.prices[k].price.trim(),
      ]),
      costPlus: WALLET_COST_PLUS_KINDS.map((k) => [k, x.costPlus[k]]),
      markup: percentToBps(x.markupPercent) ?? x.markupPercent.trim(),
    });
  return norm(d) !== norm(saved);
}
