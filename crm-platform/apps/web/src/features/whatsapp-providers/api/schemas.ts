import { z } from 'zod';

/**
 * LOCAL CONTRACT (stand-in). The whatsapp-providers API contracts live in `@crm/contracts`
 * (`packages/contracts/src/whatsapp-providers/`); until they are exported this file is the only place the web
 * names the wire shapes, so switching over is a one-file change (re-export from `@crm/contracts` here).
 */

export const PROVIDER_STATUSES = ['active', 'disabled'] as const;
export const providerStatusSchema = z.enum(PROVIDER_STATUSES);
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const ADAPTER_KINDS = ['meta_graph'] as const;
export const AUTH_SCHEMES = ['bearer', 'custom_headers'] as const;
export const CREDENTIAL_MODES = ['platform_token', 'channel_token'] as const;
export const WEBHOOK_MODES = ['meta_app_level', 'number_level_override', 'per_channel'] as const;
export const SIGNATURE_SCHEMES = ['meta_app_secret_sha256', 'shared_secret_header'] as const;
export const BILLING_MODES = ['provider_credit_line', 'customer_direct', 'meta_reseller'] as const;
export const ONBOARDING_KINDS = ['manual', 'embedded_signup'] as const;
export const CAPABILITY_KEYS = [
  'templates',
  'mediaUpload',
  'businessProfile',
  'healthStatus',
  'numberWebhookConfig',
  'analytics',
] as const;

export type AdapterKind = (typeof ADAPTER_KINDS)[number];
export type AuthScheme = (typeof AUTH_SCHEMES)[number];
export type CredentialMode = (typeof CREDENTIAL_MODES)[number];
export type WebhookMode = (typeof WEBHOOK_MODES)[number];
export type SignatureScheme = (typeof SIGNATURE_SCHEMES)[number];
export type BillingMode = (typeof BILLING_MODES)[number];
export type OnboardingKind = (typeof ONBOARDING_KINDS)[number];
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];
export type Capabilities = Record<CapabilityKey, boolean>;

/** A sealed credential is never sent back: only whether it is set and, when the API offers it, its last four characters. */
export const secretStateSchema = z.object({
  set: z.boolean(),
  last4: z.string().max(8).nullable().optional(),
});
export type SecretState = z.infer<typeof secretStateSchema>;

export const capabilitiesSchema = z.object({
  templates: z.boolean(),
  mediaUpload: z.boolean(),
  businessProfile: z.boolean(),
  healthStatus: z.boolean(),
  numberWebhookConfig: z.boolean(),
  analytics: z.boolean(),
});

export const healthSchema = z.object({
  checkedAt: z.string(),
  ok: z.boolean(),
  /** Stable failure class (see `lib/errors.ts`), null when ok. */
  code: z.string().nullable().optional(),
  latencyMs: z.number().nullable().optional(),
});
export type ProviderHealth = z.infer<typeof healthSchema>;

export const providerSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  adapterKind: z.enum(ADAPTER_KINDS),
  baseUrl: z.string(),
  apiVersion: z.string(),
  authScheme: z.enum(AUTH_SCHEMES),
  headerTemplates: z.record(z.string(), z.string()),
  credentialMode: z.enum(CREDENTIAL_MODES),
  providerToken: secretStateSchema,
  appSecret: secretStateSchema,
  verifyToken: secretStateSchema,
  webhookMode: z.enum(WEBHOOK_MODES),
  signatureScheme: z.enum(SIGNATURE_SCHEMES),
  signatureHeader: z.string().nullable(),
  billingMode: z.enum(BILLING_MODES),
  capabilities: capabilitiesSchema,
  onboardingKind: z.enum(ONBOARDING_KINDS),
  onboardingAppId: z.string().nullable(),
  onboardingConfigId: z.string().nullable(),
  status: providerStatusSchema,
  isDefault: z.boolean(),
  lastHealth: healthSchema.nullable(),
  channelCount: z.number().int().nonnegative(),
  workspaceOverrideCount: z.number().int().nonnegative().default(0),
  rowVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Provider = z.infer<typeof providerSchema>;

export const providerListSchema = z.object({ data: z.array(providerSchema) });

/** What a preset prefills. Every field is optional: a preset is a starting point, not a record. */
export const presetSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().default(''),
  defaults: z
    .object({
      key: z.string(),
      label: z.string(),
      adapterKind: z.enum(ADAPTER_KINDS),
      baseUrl: z.string(),
      apiVersion: z.string(),
      authScheme: z.enum(AUTH_SCHEMES),
      headerTemplates: z.record(z.string(), z.string()),
      credentialMode: z.enum(CREDENTIAL_MODES),
      webhookMode: z.enum(WEBHOOK_MODES),
      signatureScheme: z.enum(SIGNATURE_SCHEMES),
      signatureHeader: z.string().nullable(),
      billingMode: z.enum(BILLING_MODES),
      capabilities: capabilitiesSchema,
      onboardingKind: z.enum(ONBOARDING_KINDS),
    })
    .partial(),
});
export type Preset = z.infer<typeof presetSchema>;
export const presetListSchema = z.object({ data: z.array(presetSchema) });

/** Create / update body. A secret is `undefined` (leave alone), a string (replace) or `null` (clear). */
export const providerInputSchema = z.object({
  key: z.string(),
  label: z.string(),
  adapterKind: z.enum(ADAPTER_KINDS),
  baseUrl: z.string(),
  apiVersion: z.string(),
  authScheme: z.enum(AUTH_SCHEMES),
  headerTemplates: z.record(z.string(), z.string()),
  credentialMode: z.enum(CREDENTIAL_MODES),
  providerToken: z.string().nullable().optional(),
  appSecret: z.string().nullable().optional(),
  verifyToken: z.string().nullable().optional(),
  webhookMode: z.enum(WEBHOOK_MODES),
  signatureScheme: z.enum(SIGNATURE_SCHEMES),
  signatureHeader: z.string().nullable(),
  billingMode: z.enum(BILLING_MODES),
  capabilities: capabilitiesSchema,
  onboardingKind: z.enum(ONBOARDING_KINDS),
  onboardingAppId: z.string().nullable(),
  onboardingConfigId: z.string().nullable(),
  status: providerStatusSchema.optional(),
});
export type ProviderInput = z.infer<typeof providerInputSchema>;
export type ProviderUpdateInput = Partial<ProviderInput> & { rowVersion: number };

// --- connection test -----------------------------------------------------------------------------

export interface TestInput {
  wabaId: string;
  phoneNumberId: string;
}
export const testResultSchema = z.object({
  ok: z.boolean(),
  /** Stable failure class when `ok` is false (see `lib/errors.ts`). */
  code: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  latencyMs: z.number().nullable().optional(),
  displayName: z.string().nullable().optional(),
  verifiedName: z.string().nullable().optional(),
  qualityRating: z.string().nullable().optional(),
  throughputLevel: z.string().nullable().optional(),
  canSendMessage: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});
export type TestResult = z.infer<typeof testResultSchema>;

// --- events --------------------------------------------------------------------------------------

export const providerEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  action: z.string(),
  actor: z.string().nullable().optional(),
  detail: z.string().nullable().optional(),
});
export type ProviderEvent = z.infer<typeof providerEventSchema>;
export const providerEventListSchema = z.object({ data: z.array(providerEventSchema) });

// --- assignments ---------------------------------------------------------------------------------

export const assignmentRowSchema = z.object({
  workspaceId: z.string().uuid(),
  workspaceName: z.string(),
  workspaceSlug: z.string().nullable().optional(),
  /** The provider this workspace's NEW channels use. */
  effectiveProviderId: z.string().uuid(),
  effectiveProviderKey: z.string(),
  effectiveProviderLabel: z.string(),
  /** True when the workspace has its own override, false when it follows the platform default. */
  isOverride: z.boolean(),
  channelCount: z.number().int().nonnegative(),
});
export type AssignmentRow = z.infer<typeof assignmentRowSchema>;
export const assignmentListSchema = z.object({
  data: z.array(assignmentRowSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int(),
  }),
});

export interface AssignmentChange {
  workspaceIds: string[];
  /** The provider to set as the override, or null to clear the override (follow the default). */
  providerId: string | null;
  dryRun: boolean;
}
export const assignmentPreviewSchema = z.object({
  dryRun: z.boolean(),
  affectedWorkspaces: z.number().int().nonnegative(),
  affectedChannels: z.number().int().nonnegative(),
  rows: z.array(
    z.object({
      workspaceId: z.string().uuid(),
      workspaceName: z.string(),
      outcome: z.enum(['change', 'unchanged', 'conflict']),
      /** Why a workspace cannot change (stable code), when `outcome` is `conflict`. */
      conflictCode: z.string().nullable().optional(),
      channelCount: z.number().int().nonnegative(),
      fromProviderLabel: z.string().nullable().optional(),
    }),
  ),
});
export type AssignmentPreview = z.infer<typeof assignmentPreviewSchema>;

// --- channels and switching ----------------------------------------------------------------------

export const providerChannelSchema = z.object({
  channelId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  workspaceName: z.string(),
  label: z.string(),
  phoneDisplay: z.string().nullable().optional(),
  status: z.string(),
  queuedMessages: z.number().int().nonnegative().default(0),
});
export type ProviderChannel = z.infer<typeof providerChannelSchema>;
export const providerChannelListSchema = z.object({
  data: z.array(providerChannelSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int(),
  }),
});

export interface SwitchInput {
  targetProviderId: string;
  channelIds: string[];
  dryRun: boolean;
  force: boolean;
  /** The target provider's key, typed by the operator, on the real run. */
  confirmKey?: string;
}
export const SWITCH_RESULT_STATUSES = [
  'ready',
  'warning',
  'blocked',
  'switched',
  'failed',
  'skipped',
] as const;
export const switchChannelResultSchema = z.object({
  channelId: z.string().uuid(),
  workspaceName: z.string(),
  label: z.string(),
  status: z.enum(SWITCH_RESULT_STATUSES),
  reachable: z.boolean().nullable().optional(),
  /** Stable failure or warning code (`PROVIDER_*`, `queued_messages`, ...). */
  code: z.string().nullable().optional(),
  queuedMessages: z.number().int().nonnegative().default(0),
});
export type SwitchChannelResult = z.infer<typeof switchChannelResultSchema>;
export const switchResultSchema = z.object({
  dryRun: z.boolean(),
  targetProviderId: z.string().uuid(),
  results: z.array(switchChannelResultSchema),
});
export type SwitchResult = z.infer<typeof switchResultSchema>;

export const deletedSchema = z.object({ id: z.string().optional() }).passthrough();
