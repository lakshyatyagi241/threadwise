import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  type PlanFeatureKey,
  type PlanLimitKey,
} from './catalogue';
import { planCardSchema, planFeaturesSchema, planLimitsSchema, planSlugSchema } from './plan';

/**
 * Workspace billing and the operator's per-workspace plan (TW-PLAN-011..016, 018).
 *
 * Everything here is scoped to ONE workspace (organization): the plan a
 * workspace is on, its trial, its caps and its usage. A plan is a platform
 * catalogue row; the workspace's plan state lives in `org_plan_state`.
 */

// --- the lifecycle state (TW-PLAN-016) ---------------------------------------------------------------------

/**
 * Derived at read time from the plan, `trial_ends_at` and `plan_ends_at`; nothing flips it on a schedule.
 *   no_plan             the plan slug has no catalogue row (nothing is locked)
 *   free_trial          a free plan and the trial is still running
 *   free_trial_expired  a free plan and the trial ended: the hard gate (TW-PLAN-015) applies
 *   free                a free plan with no trial
 *   paid_active         a paid plan inside its period (or one that never expires)
 *   paid_lapsed         a paid plan whose period ended: the free plan's entitlements apply
 *   custom_quote        a sales-managed plan (period handled by the operator)
 */
export const PLAN_STATES = [
  'no_plan',
  'free_trial',
  'free_trial_expired',
  'free',
  'paid_active',
  'paid_lapsed',
  'custom_quote',
] as const;
export const planStateSchema = z.enum(PLAN_STATES);
export type PlanState = z.infer<typeof planStateSchema>;

export const planValiditySchema = z.object({
  state: planStateSchema,
  trialEndsAt: z.string().datetime().nullable(),
  planEndsAt: z.string().datetime().nullable(),
  /** Whole days, rounded up with a floor of 1 while the date is still ahead; null when there is no date. */
  daysLeft: z.number().int().nullable(),
  /** In the last 7 days of a paid period (TW-PLAN-013 renewal bar). */
  renewalWindow: z.boolean(),
});
export type PlanValidity = z.infer<typeof planValiditySchema>;

// --- the plan picker (TW-PLAN-011) -------------------------------------------------------------------------------

/** One plan card plus what the comparison table needs; the client never re-derives upgrade/downgrade. */
export const billingPlanSchema = planCardSchema.extend({
  limits: planLimitsSchema,
  features: planFeaturesSchema,
  /**
   * How choosing the card is carried out: `checkout` (a payment, PAYGW), `change` (an immediate switch with no payment: a free
   * plan, a cheaper or equal plan), `sales` (custom quote), `none` (the current plan).
   */
  via: z.enum(['checkout', 'change', 'sales', 'none']),
});
export type BillingPlan = z.infer<typeof billingPlanSchema>;

export const billingPlansResponseSchema = z.object({
  data: z.array(billingPlanSchema),
  current: z
    .object({
      slug: z.string(),
      name: z.string().nullable(),
      kind: z.enum(['free', 'paid', 'custom_quote']).nullable(),
    })
    .nullable(),
  validity: planValiditySchema,
  /** Whether the caller may change the plan (the `billing.manage` permission). */
  canManage: z.boolean(),
});
export type BillingPlansResponse = z.infer<typeof billingPlansResponseSchema>;

// --- the status bars (TW-PLAN-013) -----------------------------------------------------------------------------

export const billingStatusSchema = planValiditySchema.extend({
  planSlug: z.string(),
  planName: z.string().nullable(),
});
export type BillingStatus = z.infer<typeof billingStatusSchema>;

// --- usage (TW-PLAN-014) ---------------------------------------------------------------------------------------------

export const usageMeterSchema = z.object({
  key: z.string(),
  used: z.number().int().nonnegative(),
  /** 0 = unlimited. */
  limit: z.number().int().nonnegative(),
  /** 0..100, null when unlimited. */
  percent: z.number().int().min(0).max(100).nullable(),
  /** 'month' meters reset on the first of the calendar month; 'total' meters are lifetime counts. */
  window: z.enum(['month', 'total']),
});
export type UsageMeter = z.infer<typeof usageMeterSchema>;

export const billingUsageResponseSchema = z.object({
  planSlug: z.string(),
  planName: z.string().nullable(),
  validity: planValiditySchema,
  meters: z.array(usageMeterSchema),
  features: z.array(z.object({ key: z.string(), enabled: z.boolean() })),
  /** First instant of next calendar month: when the 'month' meters reset. */
  cycleResetsAt: z.string().datetime(),
});
export type BillingUsageResponse = z.infer<typeof billingUsageResponseSchema>;

// --- changing the plan ----------------------------------------------------------------------------------------------

/**
 * A workspace admin moves to another plan without a payment: any free plan or any cheaper/equal paid plan. A dearer
 * paid plan goes through checkout (PAYGW) and is refused here with PLAN_CHECKOUT_REQUIRED.
 */
export const changePlanRequestSchema = z.object({ planSlug: planSlugSchema });
export type ChangePlanRequest = z.infer<typeof changePlanRequestSchema>;

export const changePlanResponseSchema = z.object({
  planSlug: z.string(),
  planName: z.string(),
  direction: z.enum(['upgrade', 'downgrade', 'switch']),
  validity: planValiditySchema,
  /** Caps the new plan sets below what the workspace already holds: nothing is deleted, but adding more is blocked. */
  overLimit: z.array(
    z.object({ key: z.string(), used: z.number().int(), limit: z.number().int() }),
  ),
});
export type ChangePlanResponse = z.infer<typeof changePlanResponseSchema>;

// --- the operator: workspaces and their plan (super admin) ------------------------------------------------

/** Per-workspace overrides beat the plan (TW-PLAN-007 rule 1). Limits: whole numbers, -1 = unlimited. */
export const planOverridesSchema = z.object({
  limits: z
    .record(z.string(), z.number().int().min(-1).max(2_000_000_000))
    .default({})
    .refine(
      (r) => Object.keys(r).every((k) => (PLAN_LIMIT_KEYS as string[]).includes(k)),
      'Unknown limit key.',
    ),
  features: z
    .record(z.string(), z.boolean())
    .default({})
    .refine(
      (r) => Object.keys(r).every((k) => (PLAN_FEATURE_KEYS as string[]).includes(k)),
      'Unknown feature key.',
    ),
});
export type PlanOverrides = z.infer<typeof planOverridesSchema>;
export type PlanOverrideLimitKey = PlanLimitKey;
export type PlanOverrideFeatureKey = PlanFeatureKey;

export const workspacePlanSchema = z.object({
  workspaceId: uuidSchema,
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  planSlug: z.string(),
  planName: z.string().nullable(),
  planKnown: z.boolean(),
  platformOwned: z.boolean(),
  validity: planValiditySchema,
  billingCycle: z.enum(['trial', 'monthly', 'yearly']),
  overrides: planOverridesSchema,
  /** The plan's own caps, so the console can show what an override replaces. */
  planLimits: planLimitsSchema,
  planFeatures: planFeaturesSchema,
  rowVersion: z.number().int(),
});
export type WorkspacePlan = z.infer<typeof workspacePlanSchema>;

export const workspacePlanListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  plan: planSlugSchema.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type WorkspacePlanListQuery = z.infer<typeof workspacePlanListQuerySchema>;

export const workspacePlanListResponseSchema = z.object({
  data: z.array(workspacePlanSchema),
  nextCursor: z.string().nullable(),
});
export type WorkspacePlanListResponse = z.infer<typeof workspacePlanListResponseSchema>;

/**
 * Attach a plan to a workspace and set its overrides in one call.
 *   planEndsAt   undefined: derive from the plan's period when the plan changes (keep it otherwise);
 *                null: never expires; a datetime: that date.
 *   overrides    replaces the stored overrides; omit to keep them.
 * Attaching a different plan clears the trial.
 */
export const attachPlanRequestSchema = z.object({
  planSlug: planSlugSchema,
  planEndsAt: z.string().datetime().nullable().optional(),
  overrides: planOverridesSchema.optional(),
  rowVersion: z.number().int().min(1),
});
export type AttachPlanRequest = z.infer<typeof attachPlanRequestSchema>;

/** The 402 the trial hard gate answers with (TW-PLAN-015): `errors` carries upgradeUrl and trial. */
export const TRIAL_EXPIRED_MESSAGE =
  'Your free trial has ended. Choose a plan to keep using your workspace.';
