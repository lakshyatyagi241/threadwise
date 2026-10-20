import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { personaViewSchema } from '../persona/view';
import { planCardSchema } from '../plans-subscriptions-trials/plan';
import { accountFlagsSchema, landingSchema, orgSlugSchema } from './login';

/** `GET /v2/auth/session`: everything the web shell needs in one call. */
export const sessionUserSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  fullName: z.string(),
  displayName: z.string().nullable(),
  phone: z.string().nullable(),
  locale: z.string().nullable(),
  /** The person's own time zone; null = follow the workspace. */
  timezone: z.string().nullable(),
  theme: z.enum(['paper', 'bright', 'dark']),
  /** Same-origin proxy path, or null when no avatar is set. */
  avatarUrl: z.string().nullable(),
  emailVerified: z.boolean(),
  mfaEnabled: z.boolean(),
});

export const onboardingStepSchema = z.enum(['workspace', 'plan', 'done']);
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export const sessionOrgSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  plan: z.string(),
  timezone: z.string().nullable(),
  currency: z.string().nullable(),
  /** null = platform default footer, '' = deliberately none. */
  messageFooter: z.string().nullable(),
  onboardingStep: onboardingStepSchema,
  /**
   * The workspace's persona view (docs/specs/persona-profiles.md). Additive and optional: absent means nothing is hidden. Phase 0 only
   * delivers it; no screen reads it yet.
   */
  persona: personaViewSchema.optional(),
});

export const grantScopeSchema = z.enum(['all', 'team', 'team_and_below', 'own']);

export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  org: sessionOrgSchema,
  roles: z.array(z.object({ id: uuidSchema, name: z.string() })),
  /** Allowed permission keys and their record scope. Denied keys are absent. */
  permissions: z.record(grantScopeSchema),
  landing: landingSchema,
  flags: accountFlagsSchema,
  /** This session's id (uuid), for "this device" in the sessions list. */
  sessionId: uuidSchema,
  /** The zone dates are shown in: the person's own, else the workspace's, else UTC. */
  effectiveTimezone: z.string(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const workspaceItemSchema = z.object({
  slug: z.string(),
  name: z.string(),
  current: z.boolean(),
  /** The email is not verified in that workspace yet, so it is listed but cannot be switched to. */
  unverified: z.boolean().optional(),
});
export const workspaceListResponseSchema = z.object({ data: z.array(workspaceItemSchema) });
export type WorkspaceListResponse = z.infer<typeof workspaceListResponseSchema>;

export const switchWorkspaceRequestSchema = z.object({ orgSlug: orgSlugSchema });
export type SwitchWorkspaceRequest = z.infer<typeof switchWorkspaceRequestSchema>;

// --- onboarding (TW-AUTH-008/009) -------------------------------------------

export const industrySchema = z.enum([
  'ecommerce',
  'saas',
  'agency',
  'education',
  'healthcare',
  'finance',
  'travel',
  'hospitality',
  'other',
]);
export const teamSizeSchema = z.enum(['1', '2-5', '6-20', '21-100', '100+']);

export const onboardingWorkspaceRequestSchema = z.object({
  /** Required, at most 120 characters (Reference has no minimum above one). */
  name: z.string().trim().min(1).max(120),
  industry: industrySchema.optional(),
  sizeRange: teamSizeSchema.optional(),
  /** IANA id, validated server-side with Intl. */
  timezone: z.string().min(1).max(64),
  /** ISO 3166-1 alpha-2, validated server-side. The currency default follows it (India: INR, elsewhere: USD). */
  country: z
    .string()
    .trim()
    .length(2)
    .transform((v) => v.toUpperCase())
    .optional(),
  /**
   * The currency the workspace is billed in: one the platform can bill in. Left out, the country's default applies. Settable here
   * only until the wallet has any activity; after that an operator changes it (with a reason).
   */
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase())
    .optional(),
  /**
   * Required whenever the account has no mobile number yet (`needsPhone`), whichever way it signed up;
   * never replaces one that is already saved.
   */
  phone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/)
    .optional(),
});
export type OnboardingWorkspaceRequest = z.infer<typeof onboardingWorkspaceRequestSchema>;

/** A card of the plan step: the PLAN domain's workspace-facing plan (GET /v2/plans returns the same shape). */
export const onboardingPlanSchema = planCardSchema;

/** `plans` are the active catalogue, ordered; empty when the operator has not set any up. */
export const onboardingResponseSchema = z.object({
  step: onboardingStepSchema,
  workspace: z.object({
    name: z.string(),
    industry: industrySchema.nullable(),
    sizeRange: teamSizeSchema.nullable(),
    timezone: z.string().nullable(),
    country: z.string().nullable(),
    currency: z.string().nullable(),
  }),
  /** The currencies this workspace can be billed in, and the platform's own (the fallback when a default is not available). */
  currencies: z.object({
    available: z.array(z.string()),
    platform: z.string(),
  }),
  suggestedName: z.string(),
  /** True whenever the account has no mobile number yet (any sign-up path); `phone` is then required. */
  needsPhone: z.boolean(),
  plans: z.array(onboardingPlanSchema),
  defaultTimezone: z.string(),
  /**
   * What the plan step needs for the credits explainer and the top-up link. CPN (wallet, credit
   * packages, currencies) owns the real values; until it lands these are the platform defaults and
   * `platform_settings` key `onboarding.billing` ({ creditsPerMessage, defaultCurrency, topUpUrl })
   * overrides them. Price conversion between the plan currency and `displayCurrency` is CPN's job:
   * the plan cards keep their own currency until then.
   */
  billing: z.object({
    /** Credits one outbound message costs once the plan's messages run out. */
    creditsPerMessage: z.number().int().min(1),
    /** The currency prices should be shown in: the workspace's, else the platform default. */
    displayCurrency: z.string().length(3),
    /** Where "Top up message credits" goes. */
    topUpUrl: z.string().max(512),
  }),
});
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;
