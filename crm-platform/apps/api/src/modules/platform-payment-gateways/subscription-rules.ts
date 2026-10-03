import { addCalendar, type BillingUnit } from './fulfilment-rules';

/** The renewal cadence a provider is asked for, from the plan's own term (Reference `planInterval`). */
export function planInterval(
  unit: BillingUnit,
  duration: number,
): { interval: 'day' | 'week' | 'month' | 'year'; count: number; cycle: 'monthly' | 'yearly' } {
  const interval = { days: 'day', weeks: 'week', months: 'month', years: 'year' }[unit] as
    'day' | 'week' | 'month' | 'year';
  return {
    interval,
    count: Math.max(1, Math.trunc(duration) || 1),
    cycle: interval === 'year' ? 'yearly' : 'monthly',
  };
}

export interface RecurFacts {
  /** `pricing.recurring_enabled`. */
  platformEnabled: boolean;
  driverSupports: boolean;
  isFree: boolean;
  isLifetime: boolean;
  isCustomQuote: boolean;
  /** The plan's list amount, major units. */
  planAmount: string;
  /** What the buyer ticked. */
  autoRenew: boolean;
  period: 'monthly' | 'yearly';
}

/**
 * TW-PAYGW-012 rule 1. A purchase recurs only when the platform switch is on, the driver can, the plan is a priced term plan,
 * the buyer asked for it and the period is not yearly (a yearly purchase is one twelve-month payment).
 */
export function shouldRecur(f: RecurFacts): boolean {
  if (!f.platformEnabled || !f.driverSupports) return false;
  if (f.isFree || f.isLifetime || f.isCustomQuote) return false;
  if (!(Number(f.planAmount) > 0)) return false;
  return f.autoRenew && f.period !== 'yearly';
}

/**
 * The new end of the plan window after a subscription event (TW-PAYGW-029 rules 4 and 5). The provider's date is trusted but
 * never moves the window backwards; with no date a renewal adds one plan cycle to the later of now and the current end, and an
 * activation with no date leaves the window as the first payment's fulfilment set it (null).
 */
export function windowAfterEvent(
  now: Date,
  currentEnd: Date | null,
  providerEnd: Date | null,
  extend: boolean,
  term: { unit: BillingUnit; duration: number },
): Date | null {
  const base = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
  if (providerEnd) return providerEnd.getTime() > base.getTime() ? providerEnd : base;
  if (extend) return addCalendar(base, term.unit, Math.max(1, term.duration));
  return null;
}

/** Unix seconds, ISO text or a Date as a Date; anything unreadable is null. */
export function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const d =
    v instanceof Date
      ? v
      : typeof v === 'number' || /^\d{9,11}$/.test(String(v))
        ? new Date(Number(v) * 1000)
        : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}
