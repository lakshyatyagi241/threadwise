import { currencyExponent, majorToMinor, minorToMajor, type PaygwPeriod } from '@crm/contracts';

/**
 * Checkout arithmetic (WD-PAYGW-009, 011, 031). Everything is integer minor units (BigInt) in the currency's own exponent, so
 * there is no float anywhere and JPY or KWD come out right. Rounding is half up, matching WaDesk's 2-decimal rounding.
 */

/** Half-up integer division for non-negative operands. */
export function divRound(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (d * 2n);
}

/** "18" -> 1800n, "7.5" -> 750n: a percentage in hundredths, because tax rates carry at most two decimals. */
export function pctHundredths(pct: string | number): bigint {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(String(pct).trim());
  if (!m) throw new Error(`bad percentage: ${pct}`);
  return BigInt(m[1]! + (m[2] ?? '').padEnd(2, '0'));
}

export const taxMinor = (netMinor: bigint, ratePct: string | number): bigint =>
  divRound(netMinor * pctHundredths(ratePct), 10_000n);

/** Yearly price of a monthly plan: 12 months less the yearly discount (WaDesk: amount x 12 x (1 - pct/100)). */
export const yearlyMinor = (monthlyMinor: bigint, discountPct: number): bigint =>
  divRound(monthlyMinor * 12n * BigInt(100 - discountPct), 100n);

/**
 * Re-prices into another currency with the platform's exchange rates (each rate = units of that currency per one base unit).
 * Returns null when either rate is unknown: the caller refuses the currency rather than guess.
 */
export function convertMinor(
  minor: bigint,
  from: string,
  to: string,
  rates: ReadonlyMap<string, string>,
): bigint | null {
  if (from === to) return minor;
  const rf = rates.get(from);
  const rt = rates.get(to);
  if (!rf || !rt) return null;
  // numeric(16,6) rates as integers scaled by 1e6
  const scale = (v: string) => {
    const [w = '0', f = ''] = v.split('.');
    return BigInt(w + f.padEnd(6, '0').slice(0, 6));
  };
  const a = scale(rf);
  const b = scale(rt);
  if (a === 0n) return null;
  // minor_from / 10^ef = major; major * (rt / rf) = target major; x 10^et = target minor.
  const ef = BigInt(currencyExponent(from));
  const et = BigInt(currencyExponent(to));
  return divRound(minor * b * 10n ** et, a * 10n ** ef);
}

export interface PlanPricingFacts {
  kind: 'plan' | 'addon';
  billingUnit: 'days' | 'weeks' | 'months' | 'years';
  isFree: boolean;
  isLifetime: boolean;
  isCustomQuote: boolean;
}

/** WD-PAYGW-011 rule 3: add-ons and free, lifetime or custom plans are always monthly; a natively yearly plan always yearly. */
export function billingPeriodFor(
  plan: PlanPricingFacts,
  requested: PaygwPeriod | undefined,
  yearlyToggleEnabled: boolean,
): PaygwPeriod {
  if (plan.kind === 'addon' || plan.isFree || plan.isLifetime || plan.isCustomQuote)
    return 'monthly';
  if (plan.billingUnit === 'years') return 'yearly';
  return requested === 'yearly' && yearlyToggleEnabled ? 'yearly' : 'monthly';
}

export interface Breakdown {
  currency: string;
  subtotal: string;
  discount: string;
  taxRate: string;
  tax: string;
  total: string;
  totalMinor: bigint;
}

/** discount comes off BEFORE tax; tax is on what remains. `subtotal` is already period-adjusted and in `currency`. */
export function breakdown(
  subtotalMinor: bigint,
  currency: string,
  discountMinor: bigint,
  taxRatePct: string | number,
): Breakdown {
  const net = subtotalMinor > discountMinor ? subtotalMinor - discountMinor : 0n;
  const tax = taxMinor(net, taxRatePct);
  const total = net + tax;
  return {
    currency,
    subtotal: minorToMajor(subtotalMinor, currency),
    discount: minorToMajor(discountMinor, currency),
    taxRate: String(taxRatePct),
    tax: minorToMajor(tax, currency),
    total: minorToMajor(total, currency),
    totalMinor: total,
  };
}

export { majorToMinor, minorToMajor };

/** WSN-<yymmdd>-<6 upper alphanumerics>. Collisions are retried by the caller against the unique index. */
export function newOrderNumber(now: Date, random: (n: number) => string): string {
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `WSN-${yy}${mm}${dd}-${random(6)}`;
}
