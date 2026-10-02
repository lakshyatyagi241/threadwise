import { currencyExponent } from '@crm/contracts';

/**
 * The coupon engine (TW-CPN-006): a pure function from "this code, this order, this buyer" to "applies, and for how much" or
 * "refused, and why". No I/O and an injectable clock, so every rule has a unit test. The rules and their ORDER are Reference's
 * `Coupon::resolve`: the order decides which reason a buyer sees first, and the wording is what customers read.
 *
 * Money is integer minor units of the order currency (BigInt, the checkout's own exponent table), never a float. Reference rounded to 2 decimals whatever the currency;
 * here a zero-decimal currency rounds to whole units (the only intended difference, identical for every 2-decimal currency).
 */

export interface CouponFacts {
  id: number;
  code: string;
  type: 'percent' | 'fixed';
  /** numeric(12,4) as text: a percentage, or a sum in the order's currency. */
  amount: string;
  maxDiscountAmount: string | null;
  minOrderAmount: string | null;
  currencyCode: string | null;
  maxUses: number | null;
  usesCount: number;
  perUserLimit: number | null;
  applicablePlanSlugs: readonly string[];
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
  firstPurchaseOnly: boolean;
  stackableWithOther: boolean;
}

/** What the orders ledger says about the buyer; only read when the coupon has a per-customer rule. */
export interface BuyerFacts {
  /** Orders of this buyer in status `paid`, of any kind (plan, add-on, top-up). */
  paidOrders: number;
  /** Paid orders of this buyer that carry this coupon's code. */
  redemptions: number;
}

export interface ResolveInput {
  planSlug: string;
  /** The price the coupon applies to: the plan for the billing period, in the order currency, before tax. */
  subtotalMinor: bigint;
  currency: string;
  now: Date;
  /** Other codes already on the order (the checkout has a single input, so callers pass none, as Reference's did). */
  otherCoupons?: readonly string[];
}

export type Resolution =
  { ok: true; message: 'Coupon applied.'; discountMinor: bigint } | { ok: false; message: string };

export const COUPON_MESSAGES = {
  empty: 'Enter a coupon code.',
  unknown: (code: string) => `Coupon "${code}" not recognised.`,
  disabled: 'This coupon is disabled.',
  notYet: 'This coupon is not active yet.',
  expired: 'This coupon has expired.',
  fullyUsed: 'This coupon is fully used.',
  currency: (code: string) => `This coupon is only valid for payments in ${code}.`,
  notStackable: 'This coupon cannot be combined with another coupon.',
  firstPurchase: 'This coupon is valid on your first purchase only.',
  perUser: 'You have already used this coupon the maximum number of times.',
  minimum: 'Order is below the coupon minimum.',
  plan: 'This coupon does not apply to this plan.',
  noDiscount: 'Coupon yielded no discount.',
  applied: 'Coupon applied.',
} as const;

/** What the buyer typed, as the lookup key: trimmed and upper-cased. */
export const normalizeCouponCode = (raw: string): string => raw.trim().toUpperCase();

/** "10.5000" -> 10_5000n scaled by `scale` decimals, rounded half up; non-numeric -> 0n. */
function scaled(text: string, scale: number): bigint {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(text.trim());
  if (!m) return 0n;
  const frac = m[2] ?? '';
  const kept = frac.slice(0, scale).padEnd(scale, '0');
  let n = BigInt(m[1]! + kept);
  if (frac.length > scale && Number(frac[scale]) >= 5) n += 1n;
  return n;
}

/** A coupon amount in major units -> minor units of `currency`, half up. */
export function amountToMinor(amount: string, currency: string): bigint {
  return scaled(amount, currencyExponent(currency));
}

/** Half-up integer division of non-negative operands. */
const divRound = (n: bigint, d: bigint): bigint => (n * 2n + d) / (d * 2n);

/** The discount of `facts` on `subtotalMinor`, capped at the order itself; 0n when there is none. Rules 10 of TW-CPN-006. */
export function discountFor(facts: CouponFacts, subtotalMinor: bigint, currency: string): bigint {
  let discount: bigint;
  if (facts.type === 'percent') {
    // percent has up to 4 decimals: scale it to 1e4ths, so 20 -> 200000 and discount = subtotal * pct / (100 * 1e4).
    discount = divRound(subtotalMinor * scaled(facts.amount, 4), 1_000_000n);
    if (facts.maxDiscountAmount !== null) {
      const cap = amountToMinor(facts.maxDiscountAmount, currency);
      if (cap > 0n && cap < discount) discount = cap;
    }
  } else {
    discount = amountToMinor(facts.amount, currency);
  }
  return discount > subtotalMinor ? subtotalMinor : discount;
}

/**
 * Applies the rules in Reference's order. `facts` is null when no coupon has the code; `buyer` is null when the caller has no
 * identified buyer (then the first-purchase and per-user rules are skipped, exactly as Reference's 3-argument callers).
 */
export function resolveCoupon(
  rawCode: string,
  facts: CouponFacts | null,
  buyer: BuyerFacts | null,
  input: ResolveInput,
): Resolution {
  const code = normalizeCouponCode(rawCode);
  const refuse = (message: string): Resolution => ({ ok: false, message });
  if (code === '') return refuse(COUPON_MESSAGES.empty);
  if (!facts) return refuse(COUPON_MESSAGES.unknown(code));
  if (!facts.isActive) return refuse(COUPON_MESSAGES.disabled);

  if (facts.startsAt && facts.startsAt > input.now) return refuse(COUPON_MESSAGES.notYet);
  if (facts.expiresAt && facts.expiresAt < input.now) return refuse(COUPON_MESSAGES.expired);
  if (facts.maxUses !== null && facts.usesCount >= facts.maxUses) {
    return refuse(COUPON_MESSAGES.fullyUsed);
  }

  // The currency lock applies only when the caller says which currency the order is in (Reference skipped it otherwise).
  if (facts.currencyCode && input.currency) {
    const locked = facts.currencyCode.toUpperCase();
    if (locked !== input.currency.toUpperCase()) return refuse(COUPON_MESSAGES.currency(locked));
  }

  if (!facts.stackableWithOther) {
    const others = (input.otherCoupons ?? [])
      .map(normalizeCouponCode)
      .filter((c) => c !== '' && c !== code);
    if (others.length > 0) return refuse(COUPON_MESSAGES.notStackable);
  }

  if (buyer) {
    if (facts.firstPurchaseOnly && buyer.paidOrders > 0) {
      return refuse(COUPON_MESSAGES.firstPurchase);
    }
    if (
      facts.perUserLimit !== null &&
      facts.perUserLimit > 0 &&
      buyer.redemptions >= facts.perUserLimit
    ) {
      return refuse(COUPON_MESSAGES.perUser);
    }
  }

  if (facts.minOrderAmount !== null) {
    // Exact comparison at the coupon's own 4 decimals, so 99.995 is not rounded into passing a 100 minimum.
    const exp = currencyExponent(input.currency);
    const subtotal4 = input.subtotalMinor * 10n ** BigInt(Math.max(0, 4 - exp));
    if (exp <= 4 && subtotal4 < scaled(facts.minOrderAmount, 4)) {
      return refuse(COUPON_MESSAGES.minimum);
    }
  }

  if (facts.applicablePlanSlugs.length > 0 && !facts.applicablePlanSlugs.includes(input.planSlug)) {
    return refuse(COUPON_MESSAGES.plan);
  }

  const discountMinor = discountFor(facts, input.subtotalMinor, input.currency);
  if (discountMinor <= 0n) return refuse(COUPON_MESSAGES.noDiscount);
  return { ok: true, message: COUPON_MESSAGES.applied, discountMinor };
}

/** Plans and add-ons share slugs in one namespace; a coupon list is stored sorted and de-duplicated. */
export function normalizePlanSlugs(slugs: readonly string[] | undefined): string[] {
  return [...new Set((slugs ?? []).map((s) => s.trim()).filter((s) => s !== ''))].sort();
}

/** `expires_at` is in the past (inclusive to the instant, like the resolver). */
export const isExpired = (expiresAt: Date | null, now: Date): boolean =>
  expiresAt !== null && expiresAt < now;
