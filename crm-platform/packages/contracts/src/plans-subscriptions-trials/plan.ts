import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  type PlanFeatureKey,
  type PlanLimitKey,
} from './catalogue';
import { isMoney, moneyCents, normaliseMoney } from './money';

/**
 * Plans (WD-PLAN-001..008, 011, 017): the catalogue the operator edits, the
 * cards a workspace sees, and the rules a plan must satisfy to be saved.
 * Money is a decimal string everywhere; identifiers are uuids; the slug is the
 * stable human reference (also what `organizations.plan` stores).
 */

export const planBillingUnitSchema = z.enum(['days', 'weeks', 'months', 'years']);
export type PlanBillingUnit = z.infer<typeof planBillingUnitSchema>;

/** free | paid | custom_quote: how the plan is sold (WD-AUTH-009 rule 1, WD-PLAN-011). */
export const planKindSchema = z.enum(['free', 'paid', 'custom_quote']);
export type PlanKind = z.infer<typeof planKindSchema>;

/** At most 32 characters, lowercase letters, digits and underscores, at least one letter (never a bare number). */
export const planSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{1,32}$/, 'Use 1 to 32 letters, digits or underscores.')
  .regex(/[a-z]/, 'A slug needs at least one letter.');

const moneySchema = z
  .string()
  .trim()
  .refine(isMoney, 'Enter an amount such as 19 or 19.99.')
  .transform(normaliseMoney);

const cap = z.number().int().min(0).max(2_000_000_000);
const flag = z.boolean();

const limitsShape = Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, cap.default(0)])) as {
  [K in PlanLimitKey]: z.ZodDefault<typeof cap>;
};
const featuresShape = Object.fromEntries(
  PLAN_FEATURE_KEYS.map((k) => [k, flag.default(false)]),
) as { [K in PlanFeatureKey]: z.ZodDefault<typeof flag> };

/** 0 = unlimited. Unknown keys are dropped; missing keys are 0. */
export const planLimitsSchema = z.object(limitsShape);
export type PlanLimits = z.infer<typeof planLimitsSchema>;

/** Missing flags are off (WD-PLAN-003 rule 2); unknown keys are dropped. */
export const planFeaturesSchema = z.object(featuresShape);
export type PlanFeatures = z.infer<typeof planFeaturesSchema>;

// --- rules --------------------------------------------------------------------------------------------------------------------------------

export const PLAN_RULE_CODES = [
  'free_needs_zero_price',
  'free_no_offer',
  'custom_no_price',
  'custom_not_free',
  'paid_needs_price',
  'offer_not_lower',
  'default_needs_active',
] as const;
export type PlanRuleCode = (typeof PLAN_RULE_CODES)[number];

export interface PlanRuleIssue {
  path: 'amount' | 'offerAmount' | 'isFree' | 'isDefault';
  code: PlanRuleCode;
  message: string;
}

export interface PlanRuleInput {
  amount: string;
  offerAmount: string | null;
  isFree: boolean;
  isCustomQuote: boolean;
  isDefault: boolean;
  isActive: boolean;
}

/**
 * The cross-field rules of WD-PLAN-003 that hold for any plan, stated once for
 * the form, the request schema and the service (which re-checks the merged
 * result of a partial update). Returns every violation, not just the first.
 *
 *   - offer price strictly below the price (an offer of 0 is "no offer" and is
 *     normalised away before this runs)
 *   - a free plan costs 0 and carries no offer
 *   - a custom quote shows no price and is not free
 *   - a plan with a price is paid: price 0 means "free", say so explicitly
 *   - the signup default must be active (an inactive plan never reaches buyers)
 */
export function checkPlanRules(p: PlanRuleInput): PlanRuleIssue[] {
  const issues: PlanRuleIssue[] = [];
  const amount = moneyCents(p.amount);
  const offer = p.offerAmount === null ? null : moneyCents(p.offerAmount);

  if (p.isFree && amount !== 0) {
    issues.push({
      path: 'amount',
      code: 'free_needs_zero_price',
      message: 'A free plan must have a price of 0.',
    });
  }
  if (p.isFree && offer !== null) {
    issues.push({
      path: 'offerAmount',
      code: 'free_no_offer',
      message: 'A free plan cannot have an offer price.',
    });
  }
  if (p.isCustomQuote && (amount !== 0 || offer !== null)) {
    issues.push({
      path: 'amount',
      code: 'custom_no_price',
      message: 'A custom-quote plan shows no price: leave the price and offer empty.',
    });
  }
  if (p.isCustomQuote && p.isFree) {
    issues.push({
      path: 'isFree',
      code: 'custom_not_free',
      message: 'A plan cannot be both free and custom quote.',
    });
  }
  if (!p.isFree && !p.isCustomQuote && amount === 0) {
    issues.push({
      path: 'amount',
      code: 'paid_needs_price',
      message: 'Set a price above 0, or mark the plan as free.',
    });
  }
  if (offer !== null && !p.isFree && !p.isCustomQuote && offer >= amount) {
    issues.push({
      path: 'offerAmount',
      code: 'offer_not_lower',
      message: 'The offer price must be lower than the plan price.',
    });
  }
  if (p.isDefault && !p.isActive) {
    issues.push({
      path: 'isDefault',
      code: 'default_needs_active',
      message: 'The signup default plan must be active.',
    });
  }
  return issues;
}

// --- the operator's catalogue (WD-PLAN-001..005) ----------------------------------------------------------

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** An offer of 0 (or blank) means "no offer", as in WaDesk. */
const offerSchema = z.preprocess((v) => {
  const blank = blankToNull(v);
  return typeof blank === 'string' && isMoney(blank.trim()) && moneyCents(blank.trim()) === 0
    ? null
    : blank;
}, moneySchema.nullable());

const planFieldsShape = {
  name: z.string().trim().min(1).max(120),
  subtitle: z.preprocess(blankToNull, z.string().trim().max(191).nullable()).default(null),
  detail: z.preprocess(blankToNull, z.string().trim().max(5000).nullable()).default(null),
  amount: moneySchema.default('0.00'),
  offerAmount: offerSchema.default(null),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code.')
    .default('USD'),
  billingUnit: planBillingUnitSchema.default('months'),
  billingDuration: z.number().int().min(1).max(120).default(1),
  isFree: flag.default(false),
  isLifetime: flag.default(false),
  isActive: flag.default(true),
  isDefault: flag.default(false),
  isHighlighted: flag.default(false),
  isCustomQuote: flag.default(false),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  ctaLabel: z.string().trim().min(1).max(64).default('Get started'),
  limits: planLimitsSchema.default({}),
  features: planFeaturesSchema.default({}),
};

function applyRules<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    for (const issue of checkPlanRules(value as PlanRuleInput)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
    }
  });
}

/** Create: the slug is optional (derived from the name) and is fixed once the plan exists. */
export const createPlanRequestSchema = applyRules(
  z.object({ ...planFieldsShape, slug: planSlugSchema.optional() }),
);
export type CreatePlanRequest = z.input<typeof createPlanRequestSchema>;
export type CreatePlanPayload = z.output<typeof createPlanRequestSchema>;

/**
 * Update: any subset of the fields (no slug: it never changes). The service
 * merges the patch over the stored plan and re-checks the rules on the result,
 * so a patch that makes the stored plan inconsistent is refused too.
 */
export const updatePlanRequestSchema = z
  .object({
    ...planFieldsShape,
    // A patch names only the keys it changes; the rest keep their stored value.
    limits: planLimitsSchema.partial(),
    features: planFeaturesSchema.partial(),
  })
  .partial();
export type UpdatePlanRequest = z.input<typeof updatePlanRequestSchema>;
export type UpdatePlanPayload = z.output<typeof updatePlanRequestSchema>;

export const setPlanActiveRequestSchema = z.object({ isActive: z.boolean() });
export type SetPlanActiveRequest = z.infer<typeof setPlanActiveRequestSchema>;

export const planAdminItemSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  subtitle: z.string().nullable(),
  detail: z.string().nullable(),
  kind: planKindSchema,
  amount: z.string(),
  offerAmount: z.string().nullable(),
  currency: z.string(),
  billingUnit: planBillingUnitSchema,
  billingDuration: z.number().int(),
  isFree: z.boolean(),
  isLifetime: z.boolean(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  isHighlighted: z.boolean(),
  isCustomQuote: z.boolean(),
  sortOrder: z.number().int(),
  ctaLabel: z.string(),
  limits: planLimitsSchema,
  features: planFeaturesSchema,
  /** Organizations whose plan is this one (the delete guard, WD-PLAN-005). */
  inUse: z.number().int().nonnegative(),
  /** True when the registration policy names this plan as the signup default. */
  isRegistrationDefault: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PlanAdminItem = z.infer<typeof planAdminItemSchema>;

export const planAdminListResponseSchema = z.object({
  data: z.array(planAdminItemSchema),
  /** KPI strip (WD-PLAN-001): total plans, active ones, free ones, paid ones; custom quotes are counted apart. */
  summary: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    free: z.number().int().nonnegative(),
    paid: z.number().int().nonnegative(),
    customQuote: z.number().int().nonnegative(),
  }),
  /** The plan slug the registration policy names, if any (it may not exist or be active). */
  registrationDefaultSlug: z.string().nullable(),
});
export type PlanAdminListResponse = z.infer<typeof planAdminListResponseSchema>;

export const deletePlanResponseSchema = z.object({ ok: z.literal(true) });

// --- what a workspace sees (WD-AUTH-009, WD-PLAN-011) -----------------------------------------------------

/** What choosing this card does (WD-PLAN-011 rule 1: ranked by list price, offers ignored). */
export const planActionSchema = z.enum([
  'current',
  'continue_free',
  'contact_sales',
  'upgrade',
  'choose',
  'downgrade_unavailable',
]);
export type PlanAction = z.infer<typeof planActionSchema>;

export const planCardSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  subtitle: z.string().nullable(),
  kind: planKindSchema,
  price: z.object({
    /** List price. "0.00" for free and custom-quote plans. */
    amount: z.string(),
    /** Only when the plan is paid and the offer is below the list price. */
    offerAmount: z.string().nullable(),
    currency: z.string(),
    /** The billing period; null for free and custom-quote plans (no price to attach it to). */
    period: z.object({ unit: planBillingUnitSchema, count: z.number().int().min(1) }).nullable(),
  }),
  /** A one-time price: there is no billing period to show. */
  lifetime: z.boolean(),
  /** Messages per month; 0 = unlimited. */
  monthlyMessages: z.number().int().nonnegative(),
  /** At most three enabled features, in the fixed WaDesk order. */
  chips: z.array(z.string()).max(3),
  highlighted: z.boolean(),
  current: z.boolean(),
  action: planActionSchema,
  ctaLabel: z.string(),
});
export type PlanCard = z.infer<typeof planCardSchema>;

export const plansResponseSchema = z.object({
  data: z.array(planCardSchema),
  /** The caller's current plan slug (may not match any card: inactive or missing plan). */
  currentSlug: z.string().nullable(),
  /** When the free trial ends, if the workspace is on one. */
  trialEndsAt: z.string().datetime().nullable(),
});
export type PlansResponse = z.infer<typeof plansResponseSchema>;

// --- the lock error (WD-PLAN-017) ---------------------------------------------------------------------------------

/**
 * The 422 problem for a plan gate carries these in `errors[]` ({path,message}):
 *   feature | limit   the key that was refused (a flag | a count cap)
 *   reason            'feature_disabled' | 'limit_reached'
 *   upgradeUrl        where to send the person
 *   used / limitValue the numbers, for a count cap
 */
export interface PlanLockDetails {
  reason: 'feature_disabled' | 'limit_reached';
  key: string;
  upgradeUrl: string;
  used: number | null;
  limit: number | null;
}

export function readPlanLock(
  errors: ReadonlyArray<{ path: string; message: string }> | undefined,
): PlanLockDetails | null {
  if (!errors) return null;
  const get = (path: string) => errors.find((e) => e.path === path)?.message;
  const reason = get('reason');
  const key = get('feature') ?? get('limit');
  if ((reason !== 'feature_disabled' && reason !== 'limit_reached') || !key) return null;
  const num = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
  return {
    reason,
    key,
    upgradeUrl: get('upgradeUrl') ?? '/account/plans',
    used: num(get('used')),
    limit: num(get('limitValue')),
  };
}
