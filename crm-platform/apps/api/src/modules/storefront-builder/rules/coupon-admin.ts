import type { StoreCouponState } from '@crm/contracts';
import type { CouponTerms } from './coupon-rules';

/** A coupon code as stored: trimmed and upper case (Reference `Str::upper(trim($code))`). */
export const normalizeCouponCode = (code: string): string => code.trim().toUpperCase();

/**
 * The amount Reference stored for the form: a percentage is a whole number clamped to 1..100 (here 0..100, a 0% coupon is a free
 * shipping coupon), a flat amount is minor units, both rounded.
 */
export function normalizeCouponAmount(type: string, amount: number): number {
  const whole = Math.round(amount);
  return type === 'percent' ? Math.min(100, Math.max(0, whole)) : Math.max(0, whole);
}

/**
 * Where a coupon stands now. `inactive` (switched off) wins, then `scheduled` (not started), `expired`, `exhausted` (every use
 * taken), else `active`. Mirrors `couponRedeemable` for the parts that do not depend on the basket (the minimum spend).
 */
export function couponState(
  c: Pick<CouponTerms, 'active' | 'startsAt' | 'expiresAt' | 'usageLimit' | 'usedCount'>,
  now = new Date(),
): StoreCouponState {
  if (!c.active) return 'inactive';
  if (c.startsAt && c.startsAt.getTime() > now.getTime()) return 'scheduled';
  if (c.expiresAt && c.expiresAt.getTime() < now.getTime()) return 'expired';
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return 'exhausted';
  return 'active';
}

/** `LIKE` text for a search term: the term is literal, so `%`, `_` and the escape character itself are escaped. */
export const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The number reduced to its digits, the key an order and a saved customer share. Null when nothing is left. */
export function phoneDigits(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D+/g, '');
  return d === '' ? null : d;
}
