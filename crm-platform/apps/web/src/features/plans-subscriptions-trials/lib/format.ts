import type { BillingPlan, PlanBillingUnit, PlanState, PlanValidity } from '@crm/contracts';

/** Display only: the wire keeps money as a decimal string; a double is exact for two decimals at these sizes. */
export function formatMoney(amount: string, currency: string, locale: string): string {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    // A currency code the runtime lacks: show the code, never crash.
    return `${currency} ${value.toFixed(2)}`;
  }
}

export type PriceView =
  | { kind: 'free' }
  | { kind: 'custom' }
  | {
      kind: 'paid';
      main: string;
      strike: string | null;
      period: { unit: PlanBillingUnit; count: number } | null;
      lifetime: boolean;
    };

export function priceView(
  plan: BillingPlan,
  locale: string,
  period: Period = 'monthly',
): PriceView {
  if (plan.kind === 'free') return { kind: 'free' };
  if (plan.kind === 'custom_quote') return { kind: 'custom' };
  const { amount, offerAmount, currency, period: billing } = plan.price;
  // Yearly mode shows the per-month equivalent of the yearly price for a plan billed monthly; any other plan keeps its own price.
  if (period === 'yearly' && plan.yearly) {
    return {
      kind: 'paid',
      main: formatMoney(plan.yearly.perMonth, currency, locale),
      strike: formatMoney(offerAmount ?? amount, currency, locale),
      period: { unit: 'months', count: 1 },
      lifetime: false,
    };
  }
  return {
    kind: 'paid',
    main: formatMoney(offerAmount ?? amount, currency, locale),
    strike: offerAmount ? formatMoney(amount, currency, locale) : null,
    period: billing,
    lifetime: plan.lifetime,
  };
}

/** One row of the feature list on a card or in the comparison table. */
export type FeatureRow =
  { kind: 'limit'; key: string; value: number } | { kind: 'flag'; key: string };

/**
 * The rows a plan advertises, in the order Reference lists them: numeric limits first (0 is "unlimited"), then the capabilities
 * the plan enables. A cap of 0 is shown as unlimited, never skipped, because on this catalogue 0 is a real choice.
 */
export function featureRows(plan: Pick<BillingPlan, 'limits' | 'features'>): FeatureRow[] {
  const limits = Object.entries(plan.limits).map(([key, value]): FeatureRow => ({
    kind: 'limit',
    key,
    value,
  }));
  const flags = Object.entries(plan.features)
    .filter(([, on]) => on)
    .map(([key]): FeatureRow => ({ kind: 'flag', key }));
  return [...limits, ...flags];
}

/** The comparison table's rows: every limit and flag, in registry order, that at least one plan sets or enables. */
export function compareRows(plans: ReadonlyArray<Pick<BillingPlan, 'limits' | 'features'>>) {
  const first = plans[0];
  if (!first) return { limits: [] as string[], flags: [] as string[] };
  const limits = Object.keys(first.limits);
  const flags = Object.keys(first.features);
  return {
    limits: limits.filter((k) =>
      plans.some((p) => (p.limits as Record<string, number>)[k] !== undefined),
    ),
    flags: flags.filter((k) => plans.some((p) => (p.features as Record<string, boolean>)[k])),
  };
}

/** The validity banner's tone and which sentence it reads, from the derived state. */
export function bannerFor(v: PlanValidity): {
  tone: 'info' | 'success' | 'warning' | 'danger';
  key:
    | 'expired'
    | 'grace'
    | 'activeUntil'
    | 'activeForever'
    | 'trial'
    | 'trialEnded'
    | 'free'
    | 'customQuote';
} | null {
  switch (v.state) {
    case 'paid_grace':
      return { tone: 'warning', key: 'grace' };
    case 'paid_lapsed':
      return { tone: 'danger', key: 'expired' };
    case 'paid_active':
      return v.planEndsAt
        ? { tone: v.renewalWindow ? 'warning' : 'success', key: 'activeUntil' }
        : { tone: 'success', key: 'activeForever' };
    case 'free_trial':
      return { tone: 'warning', key: 'trial' };
    case 'free_trial_expired':
      return { tone: 'danger', key: 'trialEnded' };
    case 'free':
      return { tone: 'info', key: 'free' };
    case 'custom_quote':
      return { tone: 'info', key: 'customQuote' };
    case 'no_plan':
      return null;
  }
}

export const STATE_TONE: Record<PlanState, 'neutral' | 'success' | 'warning' | 'danger'> = {
  no_plan: 'neutral',
  free_trial: 'warning',
  free_trial_expired: 'danger',
  free: 'neutral',
  paid_active: 'success',
  paid_grace: 'warning',
  paid_lapsed: 'danger',
  custom_quote: 'neutral',
};

/** What the top-of-app bar shows, or null for none (TW-PLAN-013: trial bar and renewal bar are mutually exclusive). */
export type BarKind = 'trial' | 'trialEnded' | 'renew' | 'grace' | null;
export function barFor(v: Pick<PlanValidity, 'state' | 'renewalWindow'>): BarKind {
  if (v.state === 'free_trial') return 'trial';
  if (v.state === 'free_trial_expired') return 'trialEnded';
  if (v.state === 'paid_grace') return 'grace';
  if (v.state === 'paid_active' && v.renewalWindow) return 'renew';
  return null;
}

export const PLANS_PATH = '/account/plans';
export const USAGE_PATH = '/account/usage';
export type Period = 'monthly' | 'yearly';
/** Checkout for a plan; the yearly choice rides along as `?period=yearly` (TW-PLAN-011 rule 4). */
export const checkoutPath = (slug: string, period: Period = 'monthly') =>
  `/billing/checkout/${encodeURIComponent(slug)}${period === 'yearly' ? '?period=yearly' : ''}`;
export const SALES_PATH = '/support';
