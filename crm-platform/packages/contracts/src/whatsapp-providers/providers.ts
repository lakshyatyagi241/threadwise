import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { checkProviderBaseUrl } from './base-url';
import {
  whatsappAdapterKindSchema,
  whatsappAuthSchemeSchema,
  whatsappBillingModeSchema,
  whatsappCredentialKeySchema,
  whatsappCredentialModeSchema,
  whatsappOnboardingMethodSchema,
  whatsappProviderCapabilitiesSchema,
  whatsappProviderStatusSchema,
  whatsappSignatureSchemeSchema,
  whatsappWebhookModeSchema,
} from './enums';
import { headerTemplatesSchema } from './header-templates';

/**
 * Operator API shapes for `/v2/platform/whatsapp-providers`. Secrets are write only: a response says whether each one is set and its
 * last four characters, never the value.
 */

export const providerKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_-]{1,39}$/, 'Start with a letter; letters, digits, underscore and hyphen; 2 to 40 characters');

const labelSchema = z.string().trim().min(1).max(120);
const apiVersionSchema = z
  .string()
  .trim()
  .regex(/^v\d{1,2}\.\d{1,2}$/, 'Looks like v24.0');
/** A secret as an operator types it: printable ASCII, no spaces or line breaks (it ends up in a header). */
const secretSchema = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(/^[\x21-\x7e]+$/, 'No spaces or control characters');

/** Written, never read. On an update an absent key keeps the stored value. */
export const providerCredentialsInputSchema = z
  .object({
    /** The platform's token at the provider (a BSP partner token). */
    providerToken: secretSchema(8, 4096).optional(),
    /** Signs deliveries with `X-Hub-Signature-256` (`meta_app_secret_sha256`). */
    appSecret: secretSchema(8, 256).optional(),
    /** The secret a delivery carries in the signature header (`shared_secret_header`). */
    webhookSecret: secretSchema(8, 512).optional(),
    /** Answers the provider's GET subscription challenge. */
    verifyToken: secretSchema(8, 256).optional(),
  })
  .strict();
export type ProviderCredentialsInput = z.infer<typeof providerCredentialsInputSchema>;

const onboardingFields = {
  onboarding: whatsappOnboardingMethodSchema.optional(),
  /** The platform's Meta app id (public: it ships in the signup flow). */
  onboardingAppId: z
    .string()
    .trim()
    .regex(/^\d{5,32}$/, 'Digits only')
    .nullable()
    .optional(),
  /** The embedded signup configuration id (public). */
  onboardingConfigId: z
    .string()
    .trim()
    .regex(/^\d{5,32}$/, 'Digits only')
    .nullable()
    .optional(),
};

const signatureHeaderSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'Letters, digits and hyphens');

const baseUrlSchema = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    // The shape check; whether a loopback address is tolerated and whether the name resolves to a public address are the API's call.
    const verdict = checkProviderBaseUrl(v, { allowDevLoopback: true });
    if (!verdict.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: verdict.reason });
  });

/**
 * Create. Everything but the key may come from a preset (`presetKey`): the server fills what is absent from the preset, then from
 * plain defaults. Without a preset, `label` and `baseUrl` are required.
 */
export const createWhatsappProviderSchema = z
  .object({
    key: providerKeySchema,
    presetKey: z.string().trim().min(1).max(60).optional(),
    label: labelSchema.optional(),
    adapterKind: whatsappAdapterKindSchema.optional(),
    baseUrl: baseUrlSchema.optional(),
    apiVersion: apiVersionSchema.optional(),
    authScheme: whatsappAuthSchemeSchema.optional(),
    headerTemplates: headerTemplatesSchema.optional(),
    credentialMode: whatsappCredentialModeSchema.optional(),
    webhookMode: whatsappWebhookModeSchema.optional(),
    signatureScheme: whatsappSignatureSchemeSchema.optional(),
    signatureHeaderName: signatureHeaderSchema.nullable().optional(),
    billingMode: whatsappBillingModeSchema.optional(),
    capabilities: whatsappProviderCapabilitiesSchema.partial().optional(),
    ...onboardingFields,
    notes: z.string().trim().max(2000).optional(),
    credentials: providerCredentialsInputSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.presetKey) {
      if (!v.label) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['label'], message: 'Required' });
      if (!v.baseUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['baseUrl'], message: 'Required' });
    }
  });
export type CreateWhatsappProviderInput = z.infer<typeof createWhatsappProviderSchema>;

/** Update. `rowVersion` is the version the operator read. Absent credential keys keep their value; `clearCredentials` removes some. */
export const updateWhatsappProviderSchema = z
  .object({
    rowVersion: z.number().int().positive(),
    label: labelSchema.optional(),
    baseUrl: baseUrlSchema.optional(),
    apiVersion: apiVersionSchema.optional(),
    authScheme: whatsappAuthSchemeSchema.optional(),
    headerTemplates: headerTemplatesSchema.optional(),
    credentialMode: whatsappCredentialModeSchema.optional(),
    webhookMode: whatsappWebhookModeSchema.optional(),
    signatureScheme: whatsappSignatureSchemeSchema.optional(),
    signatureHeaderName: signatureHeaderSchema.nullable().optional(),
    billingMode: whatsappBillingModeSchema.optional(),
    capabilities: whatsappProviderCapabilitiesSchema.partial().optional(),
    ...onboardingFields,
    notes: z.string().trim().max(2000).optional(),
    credentials: providerCredentialsInputSchema.optional(),
    clearCredentials: z.array(whatsappCredentialKeySchema).max(4).optional(),
  })
  .strict();
export type UpdateWhatsappProviderInput = z.infer<typeof updateWhatsappProviderSchema>;

/** Enable, disable and make-default carry the version the operator read. */
export const providerVersionedActionSchema = z.object({ rowVersion: z.number().int().positive() }).strict();
export type ProviderVersionedActionInput = z.infer<typeof providerVersionedActionSchema>;

// --- responses ------------------------------------------------------------------------------------------------------------------

export const credentialStateSchema = z.object({
  set: z.boolean(),
  /** Last four characters, so an operator can tell which secret is stored. Null when unset. */
  last4: z.string().nullable(),
});
export type CredentialState = z.infer<typeof credentialStateSchema>;

export const providerHealthCheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  httpStatus: z.number().int().nullable(),
  detail: z.string().nullable(),
});
export type ProviderHealthCheck = z.infer<typeof providerHealthCheckSchema>;

/**
 * The outcome of a live test. It never contains the test WABA or number id and nothing Meta returned about that number: only whether
 * the provider answered and what it said about itself (status codes, error text with secrets removed).
 */
export const providerHealthSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.string().datetime(),
  latencyMs: z.number().int().nonnegative(),
  checks: z.array(providerHealthCheckSchema),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /** `sweep`: the scheduled health check (no test ids, so it only proves the provider is configured and answers). */
  source: z.enum(['test', 'sweep']),
});
export type ProviderHealth = z.infer<typeof providerHealthSchema>;

export const whatsappProviderSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  label: z.string(),
  adapterKind: whatsappAdapterKindSchema,
  baseUrl: z.string(),
  apiVersion: z.string(),
  authScheme: whatsappAuthSchemeSchema,
  headerTemplates: z.record(z.string()),
  credentialMode: whatsappCredentialModeSchema,
  webhookMode: whatsappWebhookModeSchema,
  signatureScheme: whatsappSignatureSchemeSchema,
  signatureHeaderName: z.string().nullable(),
  billingMode: whatsappBillingModeSchema,
  capabilities: whatsappProviderCapabilitiesSchema,
  onboarding: whatsappOnboardingMethodSchema,
  onboardingAppId: z.string().nullable(),
  onboardingConfigId: z.string().nullable(),
  status: whatsappProviderStatusSchema,
  isDefault: z.boolean(),
  presetKey: z.string().nullable(),
  /**
   * `meta` or `interakt` for the two providers the WABA module has built in (their address, version and secrets are the console
   * WhatsApp settings page's, read live by the registry); null for a provider added here, whose secrets are sealed in this registry.
   */
  builtin: z.enum(['meta', 'interakt']).nullable(),
  notes: z.string().nullable(),
  credentials: z.object({
    providerToken: credentialStateSchema,
    appSecret: credentialStateSchema,
    webhookSecret: credentialStateSchema,
    verifyToken: credentialStateSchema,
  }),
  /** Where this provider's deliveries go: `<APP_URL>` plus this path. */
  webhookPath: z.string(),
  lastHealth: providerHealthSchema.nullable(),
  lastHealthAt: z.string().datetime().nullable(),
  channelCount: z.number().int().nonnegative(),
  workspaceCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type WhatsappProvider = z.infer<typeof whatsappProviderSchema>;

export const whatsappProviderListSchema = z.object({ data: z.array(whatsappProviderSchema) });
export type WhatsappProviderList = z.infer<typeof whatsappProviderListSchema>;

/** Who a provider is, in the places that only need to name it (assignments, switch results, history). */
export const providerSummarySchema = z.object({ id: uuidSchema, key: z.string(), label: z.string() });
export type ProviderSummary = z.infer<typeof providerSummarySchema>;

export const whatsappProviderPresetSchema = z.object({
  presetKey: z.string(),
  label: z.string(),
  description: z.string(),
  suggestedKey: z.string(),
  adapterKind: whatsappAdapterKindSchema,
  baseUrl: z.string(),
  apiVersion: z.string(),
  authScheme: whatsappAuthSchemeSchema,
  headerTemplates: z.record(z.string()),
  credentialMode: whatsappCredentialModeSchema,
  webhookMode: whatsappWebhookModeSchema,
  signatureScheme: whatsappSignatureSchemeSchema,
  signatureHeaderName: z.string().nullable(),
  billingMode: whatsappBillingModeSchema,
  capabilities: whatsappProviderCapabilitiesSchema,
  onboarding: whatsappOnboardingMethodSchema,
  credentialsNeeded: z.array(whatsappCredentialKeySchema),
  notes: z.string(),
});
export const whatsappProviderPresetListSchema = z.object({ data: z.array(whatsappProviderPresetSchema) });
export type WhatsappProviderPresetList = z.infer<typeof whatsappProviderPresetListSchema>;

// --- live test ------------------------------------------------------------------------------------------------------------------

const graphIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.:-]{1,128}$/, 'Letters, digits and . _ : - only');

/**
 * A live test of one provider with a TEST WABA and number the operator supplies. The ids are used for the calls and forgotten: they
 * are not stored, not logged and not part of the answer. For a provider in `channel_token` mode the operator also supplies a test
 * token (also forgotten).
 */
export const testWhatsappProviderSchema = z
  .object({
    wabaId: graphIdSchema,
    phoneNumberId: graphIdSchema,
    channelToken: secretSchema(8, 4096).optional(),
  })
  .strict();
export type TestWhatsappProviderInput = z.infer<typeof testWhatsappProviderSchema>;

export const testWhatsappProviderResponseSchema = z.object({
  provider: providerSummarySchema,
  health: providerHealthSchema,
  /** The provider's status after the test: a failing test marks an active provider `error`, a passing one clears `error`. */
  status: whatsappProviderStatusSchema,
});
export type TestWhatsappProviderResponse = z.infer<typeof testWhatsappProviderResponseSchema>;
