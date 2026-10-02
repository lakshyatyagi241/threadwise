export type BillingUnit = 'days' | 'weeks' | 'months' | 'years';

/** Calendar addition in UTC with end-of-month clamping (31 Jan + 1 month = 28/29 Feb), the way a subscription calendar behaves. */
export function addCalendar(d: Date, unit: BillingUnit, n: number): Date {
  const out = new Date(d.getTime());
  if (unit === 'days') out.setUTCDate(out.getUTCDate() + n);
  else if (unit === 'weeks') out.setUTCDate(out.getUTCDate() + 7 * n);
  else {
    const months = unit === 'years' ? n * 12 : n;
    const day = out.getUTCDate();
    out.setUTCDate(1);
    out.setUTCMonth(out.getUTCMonth() + months);
    const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
    out.setUTCDate(Math.min(day, last));
  }
  return out;
}

export interface PlanTerm {
  billingUnit: BillingUnit;
  billingDuration: number;
  isFree: boolean;
  isLifetime: boolean;
  isCustomQuote: boolean;
}

/**
 * The new `plan_ends_at` after a paid plan order (WD-PAYGW-028 rule 5). Free, lifetime and custom-quote plans never expire (null).
 * Otherwise the term starts from the LATER of now and the current end, so paying early never loses days, and is one year when
 * the order is yearly on a one-month plan, else the plan's own duration.
 */
export function nextPlanEnd(
  now: Date,
  currentEnd: Date | null,
  plan: PlanTerm,
  period: 'monthly' | 'yearly',
): Date | null {
  if (plan.isFree || plan.isLifetime || plan.isCustomQuote) return null;
  const base = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
  if (period === 'yearly' && plan.billingUnit === 'months' && plan.billingDuration === 1) {
    return addCalendar(base, 'years', 1);
  }
  return addCalendar(base, plan.billingUnit, plan.billingDuration);
}
