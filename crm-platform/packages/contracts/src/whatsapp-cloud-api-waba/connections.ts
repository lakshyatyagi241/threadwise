import { isValidPhoneNumber } from 'libphonenumber-js/min';
import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/** Which API reaches a number. Both are the WhatsApp Cloud API underneath. */
export const wabaProviderSchema = z.enum(['interakt', 'meta']);
export type WabaProvider = z.infer<typeof wabaProviderSchema>;

export const wabaStatusSchema = z.enum(['pending', 'connected', 'failed', 'disconnected']);
export type WabaStatus = z.infer<typeof wabaStatusSchema>;

export const wabaConnectedViaSchema = z.enum(['embedded', 'manual']);

/** Limits from Reference's connect form (TW-WABA-006, 009, 019). */
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
  /** True once Meta delivers this number's inbound here, false when known broken, null when unproven (TW-WABA-013). */
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
  /** Whether the "connect my existing Business App number" button is offered. */
  coexistence: z.boolean(),
  defaultProvider: wabaProviderSchema,
  /** Environment names still unset, so an admin sees exactly what blocks Embedded Signup. */
  missing: z.array(z.string()),
  /** Where Meta/Interakt are told to deliver inbound events. */
  webhookUrl: z.string().nullable(),
});
export type WabaReadiness = z.infer<typeof wabaReadinessSchema>;

/** `GET /v2/platform/waba/callback` (super admin): what to paste into the Meta app's WhatsApp > Configuration. */
export const wabaPlatformCallbackSchema = z.object({
  webhookUrl: z.string().nullable(),
  verifyToken: z.string(),
  /** The webhook fields to subscribe. */
  fields: z.array(z.string()),
  /** WABA numbers connected across every workspace (Reference: "Connected WABAs"). */
  connectedWabas: z.number().int().nonnegative(),
});
export type WabaPlatformCallback = z.infer<typeof wabaPlatformCallbackSchema>;

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

export const requestVerificationCodeInputSchema = z.object({
  /** How Meta delivers the 6-digit ownership code to the number. */
  method: z.enum(['SMS', 'VOICE']).default('SMS'),
});
export type RequestVerificationCodeInput = z.infer<typeof requestVerificationCodeInputSchema>;

export const verifyCodeInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'the code is 6 digits'),
});
export type VerifyCodeInput = z.infer<typeof verifyCodeInputSchema>;

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

/** `GET /v2/waba/numbers/:id/health`: the number as Meta reports it right now, plus what is wrong with it (TW-WABA-021, 022). */
export const wabaHealthSchema = z.object({
  connection: wabaConnectionSchema,
  overall: wabaHealthSeveritySchema,
  issues: z.array(wabaHealthIssueSchema),
  /** The token with its middle masked; never the token. Null when none is stored. */
  tokenHint: z.string().nullable(),
  checkedAt: z.string().datetime(),
  /** What the other Meta reads found. Each part is independent: one failing read leaves the rest and adds to `errors`. */
  details: z.object({
    waba: z
      .object({
        name: z.string().nullable(),
        currency: z.string().nullable(),
        timezoneId: z.string().nullable(),
        accountReviewStatus: z.string().nullable(),
        businessVerificationStatus: z.string().nullable(),
        ownerBusinessName: z.string().nullable(),
        ownershipType: z.string().nullable(),
      })
      .nullable(),
    token: z.object({
      /** null = Meta could not be asked (no app credentials on the platform). */
      valid: z.boolean().nullable(),
      scopes: z.array(z.string()),
      expiresAt: z.string().datetime().nullable(),
      appId: z.string().nullable(),
    }),
    webhook: z.object({ subscribedApps: z.array(z.string()) }).nullable(),
    templates: z
      .object({
        /** Counted over the first 100 only (Reference counts the first 200): a tally, not an inventory. */
        sampled: z.number().int(),
        byStatus: z.record(z.number().int()),
      })
      .nullable(),
    phone: z.object({
      accountMode: z.string().nullable(),
      isOfficialBusinessAccount: z.boolean().nullable(),
      isPinEnabled: z.boolean().nullable(),
    }),
    /** This month's free service conversations (TW-WABA-023). Null when Meta's analytics did not answer: the card is then not shown. */
    conversations: z
      .object({
        freeUsed: z.number().int(),
        freeTotal: z.number().int(),
        freeLeft: z.number().int(),
        paid: z.number().int(),
        total: z.number().int(),
        cost: z.number(),
      })
      .nullable()
      .optional(),
    errors: z.array(z.string()),
  }),
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

/** Profile pictures: Meta takes a JPG or PNG up to 5 MB (the same limit the template header examples use). */
export const WABA_LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const WABA_LOGO_TYPES = ['image/jpeg', 'image/png'] as const;

// --- business compliance (Meta's business_compliance_info, the India compliance form) ----------------------------------------

/** The entity types Meta accepts. The form shows the words Geta uses ("Private Company"); Meta stores these values. */
export const WABA_ENTITY_TYPES = [
  'LIMITED_LIABILITY_PARTNERSHIP',
  'SOLE_PROPRIETORSHIP',
  'PARTNERSHIP',
  'PUBLIC_COMPANY',
  'PRIVATE_COMPANY',
  'OTHER',
] as const;
export type WabaEntityType = (typeof WABA_ENTITY_TYPES)[number];

/** Types that ask whether the business is registered. */
export const REGISTRATION_ASKED: readonly WabaEntityType[] = ['PARTNERSHIP', 'OTHER'];

const contactEmail = z
  .string()
  .trim()
  .max(128)
  .regex(/^$|^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Enter a complete email address');

/** A phone number with its country code (`+` first) that Meta would accept as valid, or empty. */
const contactPhone = z
  .string()
  .trim()
  .max(20)
  .refine(
    (v) => v === '' || v.startsWith('+'),
    'Enter the number with its country code, starting with +',
  )
  .refine((v) => v === '' || isValidPhoneNumber(v), 'Enter a valid number with its country code');

const contactDetails = z.object({
  email: contactEmail,
  mobile: contactPhone,
  landline: contactPhone,
});

export const wabaComplianceInfoSchema = z.object({
  entityName: z.string().nullable(),
  entityType: z.enum(WABA_ENTITY_TYPES).nullable(),
  entityTypeCustom: z.string().nullable(),
  isRegistered: z.boolean().nullable(),
  customerCare: z.object({
    email: z.string().nullable(),
    mobile: z.string().nullable(),
    landline: z.string().nullable(),
  }),
  grievanceOfficer: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    mobile: z.string().nullable(),
    landline: z.string().nullable(),
  }),
});
export type WabaComplianceInfo = z.infer<typeof wabaComplianceInfoSchema>;

/**
 * The whole compliance form, saved at once (Meta takes the same fields as one POST). The rules are Geta's: a custom type only
 * for `OTHER`, the registration question only for `PARTNERSHIP` and `OTHER`, one way to reach each side (email, mobile or
 * landline), and a grievance officer name.
 */
export const updateComplianceInfoInputSchema = z
  .object({
    entityName: z.string().trim().min(1, 'Enter the legal name of the business'),
    entityType: z.enum(WABA_ENTITY_TYPES),
    entityTypeCustom: z.string().trim().max(128).optional(),
    isRegistered: z.boolean().optional(),
    customerCare: contactDetails,
    grievanceOfficer: contactDetails.extend({
      name: z.string().trim().min(1, 'Enter the grievance officer name'),
    }),
  })
  .superRefine((v, ctx) => {
    const asked = REGISTRATION_ASKED.includes(v.entityType);
    if (asked && v.isRegistered === undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isRegistered'],
        message: 'Say whether the business is registered',
      });
    if (!asked && v.isRegistered !== undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isRegistered'],
        message: 'Only asked for partnerships and other types',
      });
    if (v.entityType === 'OTHER' && !v.entityTypeCustom)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entityTypeCustom'],
        message: 'Enter the business type',
      });
    if (!hasOneContact(v.customerCare))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerCare'],
        message: 'Enter an email, a mobile or a landline for customer care',
      });
    if (!hasOneContact(v.grievanceOfficer))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['grievanceOfficer'],
        message: 'Enter an email, a mobile or a landline for the grievance officer',
      });
  });
export type UpdateComplianceInfoInput = z.infer<typeof updateComplianceInfoInputSchema>;

function hasOneContact(c: { email: string; mobile: string; landline: string }): boolean {
  return c.email !== '' || c.mobile !== '' || c.landline !== '';
}
