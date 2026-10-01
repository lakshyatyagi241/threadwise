import { z } from 'zod';
import { uuidSchema } from '../common/ids';
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
});

export const grantScopeSchema = z.enum(['all', 'team', 'own']);

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
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const workspaceItemSchema = z.object({
  slug: z.string(),
  name: z.string(),
  current: z.boolean(),
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
  name: z.string().trim().min(2).max(120),
  industry: industrySchema.optional(),
  sizeRange: teamSizeSchema.optional(),
  /** IANA id, validated server-side with Intl. */
  timezone: z.string().min(1).max(64),
  currency: z.string().length(3).optional(),
  /** Required only when the account has no phone yet (social sign-up). */
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
    currency: z.string().nullable(),
  }),
  suggestedName: z.string(),
  needsPhone: z.boolean(),
  plans: z.array(onboardingPlanSchema),
  defaultTimezone: z.string(),
});
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;
