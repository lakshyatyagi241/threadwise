import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/** Which API reaches a number. Both are the WhatsApp Cloud API underneath. */
export const wabaProviderSchema = z.enum(['interakt', 'meta']);
export type WabaProvider = z.infer<typeof wabaProviderSchema>;

export const wabaStatusSchema = z.enum(['pending', 'connected', 'failed', 'disconnected']);
export type WabaStatus = z.infer<typeof wabaStatusSchema>;

export const wabaConnectedViaSchema = z.enum(['embedded', 'manual']);

/** Limits from WaDesk's connect form (WD-WABA-006, 009, 019). */
export const WABA_ID_MAX = 40;
export const WABA_LABEL_MAX = 120;
export const WABA_TOKEN_MAX = 1024;
export const WABA_TOKEN_MIN = 20;
export const WABA_CODE_MAX = 500;

const metaId = z
  .string()
  .trim()
  .max(WABA_ID_MAX)
  .regex(/^\d+$/, 'must be the numeric id Meta shows');

// --- reading ---------------------------------------------------------------------------------------------------------

export const wabaConnectionSchema = z.object({
  id: uuidSchema,
  provider: wabaProviderSchema,
  status: wabaStatusSchema,
  isPrimary: z.boolean(),
  displayLabel: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  verifiedName: z.string().nullable(),
  wabaId: z.string().nullable(),
  phoneNumberId: z.string().nullable(),
  businessId: z.string().nullable(),
  qualityRating: z.string().nullable(),
  /** `TIER_250`, `TIER_1K`, ... as Meta reports it. */
  messagingLimitTier: z.string().nullable(),
  platformType: z.string().nullable(),
  nameStatus: z.string().nullable(),
  codeVerificationStatus: z.string().nullable(),
  coexistence: z.boolean(),
  /** True once Meta delivers this number's inbound here, false when known broken, null when unproven (WD-WABA-013). */
  inboundWired: z.boolean().nullable(),
  inboundCheckedAt: z.string().datetime().nullable(),
  connectedVia: wabaConnectedViaSchema.nullable(),
  /** Never the token itself, only whether one is stored. */
  hasToken: z.boolean(),
  tokenExpiresAt: z.string().datetime().nullable(),
  /** The last reason a connect or health check failed, for the card. */
  lastError: z.string().nullable(),
  connectedAt: z.string().datetime().nullable(),
  lastHealthAt: z.string().datetime().nullable(),
  rowVersion: z.number().int(),
});
export type WabaConnection = z.infer<typeof wabaConnectionSchema>;

export const wabaConnectionListSchema = z.object({ items: z.array(wabaConnectionSchema) });

/** What the browser needs to launch Embedded Signup. The app secret is never here. */
export const wabaReadinessSchema = z.object({
  embeddedSignupReady: z.boolean(),
  appId: z.string().nullable(),
  configId: z.string().nullable(),
  /** Interakt's `extras.setup.solutionID`; null on the direct-Meta route. */
  solutionId: z.string().nullable(),
  graphVersion: z.string(),
  defaultProvider: wabaProviderSchema,
  /** Environment names still unset, so an admin sees exactly what blocks Embedded Signup. */
  missing: z.array(z.string()),
  /** Where Meta/Interakt are told to deliver inbound events. */
  webhookUrl: z.string().nullable(),
});
export type WabaReadiness = z.infer<typeof wabaReadinessSchema>;

// --- connecting ------------------------------------------------------------------------------------------------------

/**
 * What the browser posts after the Meta popup closes. `code` is mandatory; the ids come from the popup's
 * `WA_EMBEDDED_SIGNUP` message and are only hints: the server proves them against the token before using them.
 */
export const connectEmbeddedInputSchema = z.object({
  code: z.string().trim().min(1).max(WABA_CODE_MAX),
  wabaId: metaId.optional(),
  phoneNumberId: metaId.optional(),
  businessId: metaId.optional(),
  coexistence: z.boolean().optional(),
});
export type ConnectEmbeddedInput = z.infer<typeof connectEmbeddedInputSchema>;

export const connectManualInputSchema = z.object({
  phoneNumberId: metaId,
  wabaId: metaId,
  businessId: metaId.optional(),
  accessToken: z.string().trim().min(1).max(WABA_TOKEN_MAX),
  displayLabel: z.string().trim().max(WABA_LABEL_MAX).optional(),
  /** Own-app connects only; the platform app is used when both are absent. */
  appId: z.string().trim().max(64).optional(),
  appSecret: z.string().trim().max(128).optional(),
});
export type ConnectManualInput = z.infer<typeof connectManualInputSchema>;

export const connectResultSchema = z.object({
  connection: wabaConnectionSchema,
  /** Things that worked but need a human: inbound not wired, Interakt registration refused, a coexistence caveat. */
  warnings: z.array(z.string()),
});
export type ConnectResult = z.infer<typeof connectResultSchema>;

export const verifyTokenInputSchema = z.object({
  accessToken: z.string().trim().min(1).max(WABA_TOKEN_MAX),
  phoneNumberId: metaId.optional(),
  wabaId: metaId.optional(),
});
export type VerifyTokenInput = z.infer<typeof verifyTokenInputSchema>;

export const tokenCheckSchema = z.object({
  key: z.enum(['token', 'phone', 'waba', 'management_scope', 'cloud_api']),
  ok: z.boolean(),
  title: z.string(),
  detail: z.string(),
});
export const verifyTokenResultSchema = z.object({
  ok: z.boolean(),
  checks: z.array(tokenCheckSchema),
});
export type VerifyTokenResult = z.infer<typeof verifyTokenResultSchema>;

export const registerNumberInputSchema = z.object({
  /** The number's two-step-verification PIN; digits only, six of them. Blank uses the stored or a generated one. */
  pin: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'the PIN is 6 digits')
    .optional(),
});
export type RegisterNumberInput = z.infer<typeof registerNumberInputSchema>;

export const setTokenInputSchema = z.object({
  accessToken: z.string().trim().min(WABA_TOKEN_MIN).max(WABA_TOKEN_MAX),
});
export type SetTokenInput = z.infer<typeof setTokenInputSchema>;

export const updateConnectionInputSchema = z.object({
  displayLabel: z.string().trim().max(WABA_LABEL_MAX),
  rowVersion: z.number().int().optional(),
});
export type UpdateConnectionInput = z.infer<typeof updateConnectionInputSchema>;

// --- health ----------------------------------------------------------------------------------------------------------

export const wabaHealthSeveritySchema = z.enum(['ok', 'warning', 'error']);
export type WabaHealthSeverity = z.infer<typeof wabaHealthSeveritySchema>;

export const wabaHealthIssueSchema = z.object({
  /** Stable key the screen translates from; branch on this, never on `title`. */
  key: z.string(),
  severity: z.enum(['warning', 'error']),
  title: z.string(),
  solution: z.string(),
});
export type WabaHealthIssue = z.infer<typeof wabaHealthIssueSchema>;

/** `GET /v2/waba/numbers/:id/health`: the number as Meta reports it right now, plus what is wrong with it (WD-WABA-021, 022). */
export const wabaHealthSchema = z.object({
  connection: wabaConnectionSchema,
  overall: wabaHealthSeveritySchema,
  issues: z.array(wabaHealthIssueSchema),
  /** The token with its middle masked; never the token. Null when none is stored. */
  tokenHint: z.string().nullable(),
  checkedAt: z.string().datetime(),
});
export type WabaHealth = z.infer<typeof wabaHealthSchema>;

// --- business profile ------------------------------------------------------------------------------------------------

/** The verticals Meta accepts (taken from Geta's profile validator). */
export const WABA_VERTICALS = [
  'ALCOHOL',
  'APPAREL',
  'AUTO',
  'BEAUTY',
  'EDU',
  'ENTERTAIN',
  'EVENT_PLAN',
  'FINANCE',
  'GOVT',
  'GROCERY',
  'HEALTH',
  'HOTEL',
  'NONPROFIT',
  'ONLINE_GAMBLING',
  'OTC_DRUGS',
  'OTHER',
  'PHYSICAL_GAMBLING',
  'PROF_SERVICES',
  'RESTAURANT',
  'RETAIL',
  'TRAVEL',
] as const;

export const wabaBusinessProfileSchema = z.object({
  about: z.string().nullable(),
  address: z.string().nullable(),
  description: z.string().nullable(),
  email: z.string().nullable(),
  profilePictureUrl: z.string().nullable(),
  websites: z.array(z.string()),
  vertical: z.string().nullable(),
});
export type WabaBusinessProfile = z.infer<typeof wabaBusinessProfileSchema>;

const httpUrl = z
  .string()
  .trim()
  .max(256)
  .regex(/^https?:\/\//i, 'must start with http:// or https://');

export const updateBusinessProfileInputSchema = z
  .object({
    about: z.string().trim().min(1).max(139),
    address: z.string().trim().max(256),
    description: z.string().trim().max(512),
    email: z.string().trim().max(128).email().or(z.literal('')),
    websites: z.array(httpUrl).max(2),
    vertical: z.enum(WABA_VERTICALS),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');
export type UpdateBusinessProfileInput = z.infer<typeof updateBusinessProfileInputSchema>;
