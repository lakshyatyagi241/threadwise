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
  whatsappPartnerProgramSchema,
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
  .regex(
    /^[a-z][a-z0-9_-]{1,39}$/,
    'Start with a letter; letters, digits, underscore and hyphen; 2 to 40 characters',
  );

const labelSchema = z.string().trim().min(1).max(120);
const apiVersionSchema = z
  .string()
  .trim()
  .regex(/^v\d{1,2}(\.\d{1,2})?$/, 'Looks like v24.0 or v3');
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
  /** The partner onboarding flow after Embedded Signup (`pinnacle`). Needs `partnerSolutionId`; `null` clears both. */
  partnerProgram: whatsappPartnerProgramSchema.nullable().optional(),
  /** The partner's solution id (public: it ships in the signup flow). */
  partnerSolutionId: z
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

/** A custom-header scheme needs at least one header to carry the credential; a shared-secret signature needs the header's name. */
const consistency = (
  v: {
    authScheme?: string;
    headerTemplates?: Record<string, string>;
    signatureScheme?: string;
    signatureHeaderName?: string | null;
    partnerProgram?: string | null;
    partnerSolutionId?: string | null;
    credentialMode?: string;
  },
  ctx: z.RefinementCtx,
) => {
  if (v.partnerProgram && !v.partnerSolutionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['partnerSolutionId'],
      message: 'A partner program needs its solution id',
    });
  }
  if (v.partnerProgram && v.credentialMode !== undefined && v.credentialMode !== 'channel_token') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['credentialMode'],
      message: 'A partner program gives each number its own token: use channel_token',
    });
  }
  if (
    v.authScheme === 'custom_headers' &&
    v.headerTemplates !== undefined &&
    Object.keys(v.headerTemplates).length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['headerTemplates'],
      message: 'Custom headers need at least one header',
    });
  }
  if (v.signatureScheme === 'shared_secret_header' && !v.signatureHeaderName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['signatureHeaderName'],
      message: 'Name the header that carries the secret',
    });
  }
};

const commonFields = {
  authScheme: whatsappAuthSchemeSchema.optional(),
  headerTemplates: headerTemplatesSchema.optional(),
  credentialMode: whatsappCredentialModeSchema.optional(),
  webhookMode: whatsappWebhookModeSchema.optional(),
  signatureScheme: whatsappSignatureSchemeSchema.optional(),
  signatureHeaderName: signatureHeaderSchema.nullable().optional(),
  billingMode: whatsappBillingModeSchema.optional(),
  capabilities: whatsappProviderCapabilitiesSchema.partial().optional(),
  ...onboardingFields,
  notes: z.string().trim().max(2000).nullable().optional(),
  credentials: providerCredentialsInputSchema.optional(),
};

/** Create. Secrets are written here too; a new provider is `active` only once the operator activates it (it starts `disabled`). */
export const createWhatsappProviderSchema = z
  .object({
    key: providerKeySchema,
    label: labelSchema,
    adapterKind: whatsappAdapterKindSchema.optional(),
    baseUrl: baseUrlSchema,
    apiVersion: apiVersionSchema.optional(),
    ...commonFields,
  })
  .strict()
  .superRefine(consistency);
export type CreateWhatsappProviderInput = z.infer<typeof createWhatsappProviderSchema>;

/** Update. `rowVersion` is the version the operator read. Absent credential keys keep their value; `clearCredentials` removes some. */
export const updateWhatsappProviderSchema = z
  .object({
    rowVersion: z.number().int().positive(),
    label: labelSchema.optional(),
    baseUrl: baseUrlSchema.optional(),
    apiVersion: apiVersionSchema.optional(),
    ...commonFields,
    clearCredentials: z.array(whatsappCredentialKeySchema).max(4).optional(),
  })
  .strict()
  .superRefine(consistency);
export type UpdateWhatsappProviderInput = z.infer<typeof updateWhatsappProviderSchema>;

/** Enable, disable, archive and make-default carry the version the operator read. */
export const providerVersionedActionSchema = z
  .object({ rowVersion: z.number().int().positive() })
  .strict();
export type ProviderVersionedActionInput = z.infer<typeof providerVersionedActionSchema>;

// --- responses ------------------------------------------------------------------------------------------------------------------

export const credentialStateSchema = z.object({
  set: z.boolean(),
  /** Last four characters, so an operator can tell which secret is stored. Null when unset. */
  last4: z.string().nullable(),
});
export type CredentialState = z.infer<typeof credentialStateSchema>;

/**
 * The outcome of the last live test: whether the provider answered an authenticated read and what it said about itself. Never an id of a
 * customer's number and never a secret.
 */
export const providerTestResultSchema = z.object({
  ok: z.boolean(),
  testedAt: z.string().datetime(),
  latencyMs: z.number().int().nonnegative(),
  httpStatus: z.number().int().nullable(),
  /** A problem code (`WAP_BASE_URL_REFUSED`, `WAP_CREDENTIALS_MISSING`, ...) or the provider's HTTP outcome; null when ok. */
  errorCode: z.string().nullable(),
  /** The reason, with every secret removed. */
  message: z.string().nullable(),
});
export type ProviderTestResult = z.infer<typeof providerTestResultSchema>;

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
  /** The reseller billing engine's mode this label points at (`null`: nothing to manage there). Informational. */
  engineBillingMode: z.enum(['meta_direct', 'reseller']).nullable(),
  capabilities: whatsappProviderCapabilitiesSchema,
  onboarding: whatsappOnboardingMethodSchema,
  onboardingAppId: z.string().nullable(),
  onboardingConfigId: z.string().nullable(),
  partnerProgram: whatsappPartnerProgramSchema.nullable(),
  partnerSolutionId: z.string().nullable(),
  status: whatsappProviderStatusSchema,
  isDefault: z.boolean(),
  /**
   * `meta` or `interakt` for the two providers the WABA module has built in: their address, version and secrets are the console
   * WhatsApp settings page's (or the `WABA_ENV` values) read live, not this registry's. Null for a provider added here, whose secrets are
   * sealed in this registry.
   */
  builtin: z.enum(['meta', 'interakt']).nullable(),
  notes: z.string().nullable(),
  credentials: z.object({
    providerToken: credentialStateSchema,
    appSecret: credentialStateSchema,
    webhookSecret: credentialStateSchema,
    verifyToken: credentialStateSchema,
  }),
  /** Where this provider's deliveries go: `<public origin>` plus this path (the one platform webhook). */
  webhookPath: z.string(),
  lastTest: providerTestResultSchema.nullable(),
  /** WABA numbers on this provider, and workspaces with an override pointing at it. */
  numberCount: z.number().int().nonnegative(),
  workspaceCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type WhatsappProvider = z.infer<typeof whatsappProviderSchema>;

export const whatsappProviderListSchema = z.object({ data: z.array(whatsappProviderSchema) });
export type WhatsappProviderList = z.infer<typeof whatsappProviderListSchema>;

/** Who a provider is, in the places that only need to name it (assignments, switch results). */
export const providerSummarySchema = z.object({
  id: uuidSchema,
  key: z.string(),
  label: z.string(),
});
export type ProviderSummary = z.infer<typeof providerSummarySchema>;
