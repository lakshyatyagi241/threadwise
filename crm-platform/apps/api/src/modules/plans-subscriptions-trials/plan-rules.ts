import {
  PLAN_CHIP_MAX,
  PLAN_CHIP_ORDER,
  moneyCents,
  storedFeature,
  storedLimit,
  type PlanAction,
  type PlanBillingUnit,
  type PlanCard,
  type PlanKind,
} from '@crm/contracts';

/**
 * The pure rules of the plan catalogue: no database, no clock, no framework.
 * Everything the signup resolver, the plan cards and the plan form's slug
 * derivation decide is decided here, so it is unit-testable without a server.
 */

/** The slice of a plan row these rules read. */
export interface PlanFacts {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  amount: string;
  offerAmount: string | null;
  currency: string;
  billingUnit: PlanBillingUnit;
  billingDuration: number;
  isFree: boolean;
  isLifetime: boolean;
  isActive: boolean;
  isDefault: boolean;
  isHighlighted: boolean;
  isCustomQuote: boolean;
  sortOrder: number;
  ctaLabel: string;
  limits: unknown;
  features: unknown;
}

/** The literal slug a sign-up falls back to even when no such plan exists (TW-PLAN-008 step 4). */
export const FALLBACK_PLAN_SLUG = 'starter';

/**
 * How a plan is sold. A custom quote is checked first because it carries no
 * price (amount 0) and must not read as free; a plan is free when it is flagged
 * free or priced at 0 (Reference's `isFreePlan`).
 */
export function planKind(p: Pick<PlanFacts, 'isFree' | 'isCustomQuote' | 'amount'>): PlanKind {
  if (p.isCustomQuote) return 'custom_quote';
  if (p.isFree || moneyCents(p.amount) === 0) return 'free';
  return 'paid';
}

/** Catalogue order: operator's sort order, then cheapest first, then oldest (a stable tie-break Reference lacked). */
export function byCatalogueOrder<T extends Pick<PlanFacts, 'sortOrder' | 'amount' | 'slug'>>(
  a: T,
  b: T,
): number {
  return (
    a.sortOrder - b.sortOrder ||
    moneyCents(a.amount) - moneyCents(b.amount) ||
    a.slug.localeCompare(b.slug)
  );
}

export type DefaultPlanStep = 'setting' | 'flagged' | 'free' | 'literal';

export interface ResolvedDefaultPlan<T extends PlanFacts = PlanFacts> {
  slug: string;
  /** null when the literal fallback was used and no plan has that slug. */
  plan: T | null;
  step: DefaultPlanStep;
}

/**
 * The 4-step signup plan resolution (TW-PLAN-008 rule 1), over the plans the
 * catalogue holds:
 *   1. the registration setting's plan, if it exists and is active
 *   2. else the first active plan flagged "default"
 *   3. else the first active free plan by sort order
 *   4. else the literal slug `starter`, even when no plan has it
 * Add-ons never qualify (the caller passes plans only).
 */
export function pickDefaultPlan<T extends PlanFacts>(
  plans: readonly T[],
  settingSlug: string | null | undefined,
): ResolvedDefaultPlan<T> {
  const active = plans.filter((p) => p.isActive).sort(byCatalogueOrder);

  const wanted = settingSlug?.trim().toLowerCase();
  if (wanted) {
    const set = active.find((p) => p.slug === wanted);
    if (set) return { slug: set.slug, plan: set, step: 'setting' };
  }
  const flagged = active.find((p) => p.isDefault);
  if (flagged) return { slug: flagged.slug, plan: flagged, step: 'flagged' };

  const free = active.find((p) => planKind(p) === 'free');
  if (free) return { slug: free.slug, plan: free, step: 'free' };

  return { slug: FALLBACK_PLAN_SLUG, plan: null, step: 'literal' };
}

export interface TrialStamp {
  trialEndsAt: Date | null;
  billingCycle: 'trial' | 'monthly';
}

const DAY_MS = 86_400_000;

/**
 * The trial rule (TW-PLAN-008 rule 3): only when the resolved plan is free AND
 * the trial length is above 0 does the workspace get `trial_ends_at = now +
 * days` and billing cycle `trial`. A paid default never starts a trial, a
 * free plan with 0 days has no expiry, and a plan that does not exist (the
 * literal fallback) is not "free", so it gets no trial either.
 */
export function trialFor(
  plan: Pick<PlanFacts, 'isFree' | 'isCustomQuote' | 'amount'> | null,
  trialDays: number,
  now: Date,
): TrialStamp {
  if (plan && planKind(plan) === 'free' && trialDays > 0) {
    return { trialEndsAt: new Date(now.getTime() + trialDays * DAY_MS), billingCycle: 'trial' };
  }
  return { trialEndsAt: null, billingCycle: 'monthly' };
}

/**
 * What choosing `target` does for a workspace on `current` (TW-PLAN-011 rule 1).
 *
 *   - the same plan                      -> current
 *   - custom quote                       -> contact_sales
 *   - free                               -> continue_free (choosing it changes nothing)
 *   - paid, no known current plan        -> choose (every paid plan is buyable)
 *   - paid, current is free              -> upgrade (every paid plan is one)
 *   - paid, current is a custom quote    -> downgrade_unavailable (the top tier)
 *   - paid vs paid                       -> by LIST price, offers ignored (the stable tier ranking):
 *       dearer = upgrade, cheaper = downgrade_unavailable (downgrades are not online), equal = choose
 */
export function classifyPlanAction(
  current: Pick<PlanFacts, 'slug' | 'isFree' | 'isCustomQuote' | 'amount'> | null,
  currentSlug: string | null,
  target: Pick<PlanFacts, 'slug' | 'isFree' | 'isCustomQuote' | 'amount'>,
): PlanAction {
  if (currentSlug !== null && target.slug === currentSlug) return 'current';
  const kind = planKind(target);
  if (kind === 'custom_quote') return 'contact_sales';
  if (kind === 'free') return 'continue_free';
  if (!current) return 'choose';
  const currentKind = planKind(current);
  if (currentKind === 'custom_quote') return 'downgrade_unavailable';
  if (currentKind === 'free') return 'upgrade';
  const diff = moneyCents(target.amount) - moneyCents(current.amount);
  if (diff > 0) return 'upgrade';
  if (diff < 0) return 'downgrade_unavailable';
  return 'choose';
}

/** Up to three enabled features, in the fixed Reference order (Analytics, Automation, AI assistants, ...). */
export function pickChips(features: unknown, max = PLAN_CHIP_MAX): string[] {
  const chips: string[] = [];
  for (const key of PLAN_CHIP_ORDER) {
    if (chips.length >= max) break;
    if (storedFeature(features, key)) chips.push(key);
  }
  return chips;
}

/** A workspace-facing card (TW-AUTH-009 / TW-PLAN-011). */
export function buildPlanCard(
  plan: PlanFacts,
  currentSlug: string | null,
  currentPlan: PlanFacts | null,
): PlanCard {
  const kind = planKind(plan);
  const paid = kind === 'paid';
  const offer =
    paid && plan.offerAmount !== null && moneyCents(plan.offerAmount) > 0
      ? moneyCents(plan.offerAmount) < moneyCents(plan.amount)
        ? plan.offerAmount
        : null
      : null;
  return {
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    subtitle: plan.subtitle,
    kind,
    price: {
      amount: paid ? plan.amount : '0.00',
      offerAmount: offer,
      currency: plan.currency,
      period:
        paid && !plan.isLifetime ? { unit: plan.billingUnit, count: plan.billingDuration } : null,
    },
    lifetime: paid && plan.isLifetime,
    monthlyMessages: storedLimit(plan.limits, 'monthly_messages'),
    chips: pickChips(plan.features),
    highlighted: plan.isHighlighted,
    current: currentSlug !== null && plan.slug === currentSlug,
    action: classifyPlanAction(currentPlan, currentSlug, plan),
    ctaLabel: plan.ctaLabel,
  };
}

// --- slugs (TW-PLAN-003 rule 1) --------------------------------------------------------------------------------------------

const SLUG_MAX = 32;

/** Name or requested slug -> lowercase letters, digits and underscores, at most 32, never without a letter. */
export function slugifyPlanName(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/_+$/g, '');
  return /[a-z]/.test(base) ? base : 'plan';
}

/** `base`, else `base_2`, `base_3`, ... (the suffix counts toward the 32 characters). */
export function uniquePlanSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const trimmed = base.slice(0, SLUG_MAX - suffix.length).replace(/_+$/g, '');
    const candidate = `${/[a-z]/.test(trimmed) ? trimmed : 'plan'}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
