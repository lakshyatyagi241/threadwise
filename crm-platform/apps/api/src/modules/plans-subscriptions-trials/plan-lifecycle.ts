import { moneyCents, type PlanState, type PlanValidity } from '@crm/contracts';
import { planKind, type PlanFacts } from './plan-rules';

/**
 * The lifecycle of one workspace's plan (WD-PLAN-016): pure functions over the plan and the two dates, so the table in the
 * inventory is covered by unit tests without a database or a clock.
 */

const DAY_MS = 86_400_000;
/** The renewal bar's window (WD-PLAN-013): the last 7 days of a paid period. */
export const RENEWAL_WINDOW_DAYS = 7;

type PlanKindFacts = Pick<PlanFacts, 'isFree' | 'isCustomQuote' | 'amount'>;

export interface LifecycleInput {
  /** null = the workspace's plan slug has no catalogue row. */
  plan: PlanKindFacts | null;
  trialEndsAt: Date | null;
  planEndsAt: Date | null;
  now: Date;
  /** A live autopay subscription (active or retrying) for this plan: only then does the grace period apply. */
  autopay?: boolean;
  /** `billing.grace_days`; 0 or absent = no grace. */
  graceDays?: number;
}

/** When access ends for a paid plan whose period has passed but whose autopay is still live; null when no grace applies. */
export function graceEndsAtOf(
  i: Pick<LifecycleInput, 'planEndsAt' | 'autopay' | 'graceDays'>,
): Date | null {
  if (!i.autopay || !i.planEndsAt || !i.graceDays || i.graceDays <= 0) return null;
  return new Date(i.planEndsAt.getTime() + i.graceDays * DAY_MS);
}

/**
 * The state table of WD-PLAN-016, in order:
 *   no plan row                                  -> no_plan
 *   custom quote                                 -> custom_quote (never lapses online; the operator manages it)
 *   free + trial_ends_at ahead / behind          -> free_trial / free_trial_expired
 *   free, no trial                               -> free
 *   paid + (no end date | end ahead)             -> paid_active
 *   paid + end passed + live autopay + inside grace -> paid_grace (entitlements stay, `billing.grace_days`)
 *   paid + end date passed                       -> paid_lapsed
 */
export function planStateOf(i: LifecycleInput): PlanState {
  if (!i.plan) return 'no_plan';
  const kind = planKind(i.plan);
  if (kind === 'custom_quote') return 'custom_quote';
  if (kind === 'free') {
    if (!i.trialEndsAt) return 'free';
    return i.trialEndsAt.getTime() > i.now.getTime() ? 'free_trial' : 'free_trial_expired';
  }
  if (i.planEndsAt && i.planEndsAt.getTime() <= i.now.getTime()) {
    const graceEnd = graceEndsAtOf(i);
    return graceEnd && graceEnd.getTime() > i.now.getTime() ? 'paid_grace' : 'paid_lapsed';
  }
  return 'paid_active';
}

/** Whole days until `date`, rounded up, with a floor of 1 while it is still ahead (the last day reads "1 day"). */
export function daysUntil(date: Date | null, now: Date): number | null {
  if (!date) return null;
  const ms = date.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

export function validityOf(i: LifecycleInput): PlanValidity {
  return validityForState(planStateOf(i), i);
}

/** Same as `validityOf` for a state the caller already resolved (the entitlement resolver does). */
export function validityForState(
  state: PlanState,
  i: Pick<LifecycleInput, 'trialEndsAt' | 'planEndsAt' | 'now' | 'autopay' | 'graceDays'>,
): PlanValidity {
  const trialRunning = state === 'free_trial';
  const graceEnd = state === 'paid_grace' ? graceEndsAtOf(i) : null;
  const target = trialRunning ? i.trialEndsAt : state === 'paid_active' ? i.planEndsAt : graceEnd;
  const left = daysUntil(target, i.now);
  return {
    state,
    trialEndsAt: i.trialEndsAt ? i.trialEndsAt.toISOString() : null,
    planEndsAt: i.planEndsAt ? i.planEndsAt.toISOString() : null,
    daysLeft: left,
    renewalWindow:
      state === 'paid_active' &&
      i.planEndsAt !== null &&
      left !== null &&
      left >= 1 &&
      left <= RENEWAL_WINDOW_DAYS,
    graceEndsAt: graceEnd ? graceEnd.toISOString() : null,
  };
}

/** Whether the free plan's entitlements apply instead of the stored plan's (a lapsed paid plan, WD-PLAN-016 row "Paid, lapsed"). */
export const fallsBackToFree = (state: PlanState): boolean => state === 'paid_lapsed';

// --- changing the plan ----------------------------------------------------------------------------------------------------

export type ChangeDirection = 'upgrade' | 'downgrade' | 'switch';

/**
 * Ranks by LIST price (offers ignored, WD-PLAN-011 rule 1): a free plan ranks below any paid plan, a custom quote above all.
 * `switch` is the same rank (two free plans, or two paid plans at the same price).
 */
export function changeDirection(
  current: PlanKindFacts | null,
  target: PlanKindFacts,
): ChangeDirection {
  if (!current) return 'upgrade';
  const rank = (p: PlanKindFacts): number => {
    const kind = planKind(p);
    return kind === 'custom_quote'
      ? Number.MAX_SAFE_INTEGER
      : kind === 'free'
        ? 0
        : moneyCents(p.amount);
  };
  const diff = rank(target) - rank(current);
  return diff > 0 ? 'upgrade' : diff < 0 ? 'downgrade' : 'switch';
}

export type BillingUnit = 'days' | 'weeks' | 'months' | 'years';

/** Calendar addition in UTC with end-of-month clamping (31 Jan + 1 month = 28/29 Feb). */
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

/** The period end an operator attach stamps when the plan changes and no date is given: free, lifetime and custom quotes never expire. */
export function defaultPeriodEnd(
  now: Date,
  plan: Pick<
    PlanFacts,
    'isFree' | 'isLifetime' | 'isCustomQuote' | 'amount' | 'billingUnit' | 'billingDuration'
  >,
): Date | null {
  if (planKind(plan) !== 'paid' || plan.isLifetime) return null;
  return addCalendar(now, plan.billingUnit, plan.billingDuration);
}

/** First instant of the next calendar month (UTC): when the monthly meters reset. */
export function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
