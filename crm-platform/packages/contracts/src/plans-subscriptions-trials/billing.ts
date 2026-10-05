import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  type PlanFeatureKey,
  type PlanLimitKey,
} from './catalogue';
import {
  planCardSchema,
  planFeaturesSchema,
  planLimitsSchema,
  planSlugSchema,
  visibleAddonSchema,
} from './plan';

/**
 * Workspace billing and the operator's per-workspace plan (WD-PLAN-011..016, 018).
 *
 * Everything here is scoped to ONE workspace (organization): the plan a
 * workspace is on, its trial, its caps and its usage. A plan is a platform
 * catalogue row; the workspace's plan state lives in `org_plan_state`.
 */

// --- the lifecycle state (WD-PLAN-016) ---------------------------------------------------------------------

/**
 * Derived at read time from the plan, `trial_ends_at` and `plan_ends_at`; nothing flips it on a schedule.
 *   no_plan             the plan slug has no catalogue row (nothing is locked)
 *   free_trial          a free plan and the trial is still running
 *   free_trial_expired  a free plan and the trial ended: the hard gate (WD-PLAN-015) applies
 *   free                a free plan with no trial
 *   paid_active         a paid plan inside its period (or one that never expires)
 *   paid_grace          the period ended but autopay is still live: entitlements stay for billing.grace_days
 *   paid_lapsed         a paid plan whose period ended: the free plan's entitlements apply
 *   custom_quote        a sales-managed plan (period handled by the operator)
 */
export const PLAN_STATES = [
  'no_plan',
  'free_trial',
  'free_trial_expired',
  'free',
  'paid_active',
  'paid_grace',
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
  /** In the last 7 days of a paid period (WD-PLAN-013 renewal bar). */
  renewalWindow: z.boolean(),
  /** In `paid_grace`: when access ends unless the next charge succeeds; otherwise null. */
  graceEndsAt: z.string().datetime().nullable(),
});
export type PlanValidity = z.infer<typeof planValiditySchema>;

// --- the plan picker (WD-PLAN-011) -------------------------------------------------------------------------------

/** One plan card plus what the comparison table needs; the client never re-derives upgrade/downgrade. */
export const billingPlanSchema = planCardSchema.extend({
  limits: planLimitsSchema,
  features: planFeaturesSchema,
  /**
   * How choosing the card is carried out: `checkout` (a payment, PAYGW), `change` (an immediate switch with no payment: a free
   * plan, a cheaper or equal plan), `sales` (custom quote), `none` (the current plan).
   */
  via: z.enum(['checkout', 'change', 'sales', 'none']),
  /**
   * The yearly price of a plan billed monthly: 12 months of the effective price less the yearly discount, and the per-month equivalent
   * the card shows. null for free, lifetime, custom-quote and plans not billed once a month (a plan authored in years IS the yearly price).
   */
  yearly: z.object({ perMonth: z.string(), perYear: z.string() }).nullable(),
  /** The Marketplace add-ons this plan makes visible (for the compare table). `owned` is about the CALLING workspace. */
  visibleAddons: z.array(visibleAddonSchema),
});
export type BillingPlan = z.infer<typeof billingPlanSchema>;

/** The workspace's renewing subscription, if any (WD-PLAN-012): it is what makes "Cancel auto-renew" appear. */
export const billingSubscriptionSchema = z.object({
  status: z.enum(['active', 'past_due']),
  renewsAt: z.string().datetime().nullable(),
});
export type BillingSubscription = z.infer<typeof billingSubscriptionSchema>;

export const cancelSubscriptionResponseSchema = z.object({
  status: z.literal('canceled'),
  /** Whether the gateway was told: `ok`, `failed` (the local row is cancelled anyway, the operator reconciles) or `unsupported`. */
  remote: z.enum(['ok', 'failed', 'unsupported']),
  /** The paid period keeps running until this date. */
  planEndsAt: z.string().datetime().nullable(),
});
export type CancelSubscriptionResponse = z.infer<typeof cancelSubscriptionResponseSchema>;

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
  /** Whether the caller may change the plan (`plan.subscription.manage`). */
  canManage: z.boolean(),
  subscription: billingSubscriptionSchema.nullable(),
  /** The add-ons available on the workspace's current plan, with owned or not ("Add-ons available on your plan"). */
  visibleAddons: z.array(visibleAddonSchema),
  /** The Monthly/Yearly switch: on when the operator setting is on AND at least one card has a yearly price. */
  yearlyToggle: z.object({ enabled: z.boolean(), discountPct: z.number().int().min(0).max(100) }),
});
export type BillingPlansResponse = z.infer<typeof billingPlansResponseSchema>;

// --- the status bars (WD-PLAN-013) -----------------------------------------------------------------------------

export const billingStatusSchema = planValiditySchema.extend({
  planSlug: z.string(),
  planName: z.string().nullable(),
  /** A renewing subscription exists: the bars offer "Cancel auto-renew" and the renewal text says it renews. */
  subscription: billingSubscriptionSchema.nullable(),
});
export type BillingStatus = z.infer<typeof billingStatusSchema>;

// --- usage (WD-PLAN-014) ---------------------------------------------------------------------------------------------

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

/** What `GET billing/usage` answers: the usage above plus the add-ons the workspace's current plan makes visible (owned or not). */
export const billingUsagePanelResponseSchema = billingUsageResponseSchema.extend({
  visibleAddons: z.array(visibleAddonSchema),
});
export type BillingUsagePanelResponse = z.infer<typeof billingUsagePanelResponseSchema>;

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

/** Per-workspace overrides beat the plan (WD-PLAN-007 rule 1). Limits: whole numbers, -1 = unlimited. */
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
  /** Data retention for this workspace alone (WD-PLAN-023): days after its paid plan lapses. null = the plan's value; 0 = never wipe this workspace. */
  dataRetentionDays: z.number().int().min(0).max(3650).nullable().default(null),
});
export type PlanOverrides = z.infer<typeof planOverridesSchema>;
export type PlanOverrideLimitKey = PlanLimitKey;
export type PlanOverrideFeatureKey = PlanFeatureKey;

/**
 * The operator's view of a workspace's Marketplace add-ons. `visible`: what its plan makes visible (with `owned`). `owned`: what it
 * holds now, with `visibleOnPlan` false for something bought and then no longer shown by the plan (it stays usable: a purchase is kept).
 */
export const workspaceAddonsSchema = z.object({
  visible: z.array(visibleAddonSchema),
  owned: z.array(
    z.object({
      id: uuidSchema,
      packSlug: z.string(),
      app: z.object({ id: uuidSchema, slug: z.string(), name: z.string() }),
      endsAt: z.string().datetime().nullable(),
      visibleOnPlan: z.boolean(),
    }),
  ),
});
export type WorkspaceAddons = z.infer<typeof workspaceAddonsSchema>;

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
  /** What the workspace owns of the Marketplace versus what its plan makes visible. */
  addons: workspaceAddonsSchema,
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
  /** The free-trial end for this workspace: a date extends or shortens it, null ends the trial now. Omitted: unchanged (a changed plan always clears it). */
  trialEndsAt: z.string().datetime().nullable().optional(),
  rowVersion: z.number().int().min(1),
});
export type AttachPlanRequest = z.infer<typeof attachPlanRequestSchema>;

/** The 402 the trial hard gate answers with (WD-PLAN-015): `errors` carries upgradeUrl and trial. */
export const TRIAL_EXPIRED_MESSAGE =
  'Your free trial has ended. Choose a plan to keep using your workspace.';

// --- retention (WD-PLAN-023), operator ---------------------------------------------------------------------------------

export const RETENTION_CONFIRM = 'WIPE';

/** `dryRun` (the default) counts what would go and rolls back; a real run must carry `confirm: "WIPE"`. */
export const retentionRunRequestSchema = z
  .object({ dryRun: z.boolean().default(true), confirm: z.string().optional() })
  .refine((v) => v.dryRun || v.confirm === RETENTION_CONFIRM, {
    message: 'Type WIPE to confirm a real run.',
    path: ['confirm'],
  });
export type RetentionRunRequest = z.input<typeof retentionRunRequestSchema>;

export const retentionRunResponseSchema = z.object({
  dryRun: z.boolean(),
  workspaces: z.array(
    z.object({
      slug: z.string(),
      wiped: z.boolean(),
      rows: z.record(z.string(), z.number().int()),
    }),
  ),
});
export type RetentionRunResponse = z.infer<typeof retentionRunResponseSchema>;

// --- platform plan settings (super admin) -------------------------------------------------------------------------------

/** The two pricing settings checkout, the plan picker and the public page all read (`pricing.yearly_toggle_enabled`, `pricing.yearly_discount_pct`). */
export const planSettingsSchema = z.object({
  yearlyToggleEnabled: z.boolean(),
  yearlyDiscountPct: z.number().int().min(0).max(90),
});
export type PlanSettings = z.infer<typeof planSettingsSchema>;

// --- entitlements for the app shell (WD-PLAN-020, 021) ------------------------------------------------------------

/** The plan features the workspace has, as keys: the shell locks menu entries and draws the paywall sheet from it. */
export const entitlementsResponseSchema = z.object({ features: z.array(z.string()) });
export type EntitlementsResponse = z.infer<typeof entitlementsResponseSchema>;

/** `unlocks`: only the plans that include this feature (the paywall sheet lists exactly those). */
export const billingPlansQuerySchema = z.object({
  unlocks: z.enum(PLAN_FEATURE_KEYS as [PlanFeatureKey, ...PlanFeatureKey[]]).optional(),
});
export type BillingPlansQuery = z.infer<typeof billingPlansQuerySchema>;
