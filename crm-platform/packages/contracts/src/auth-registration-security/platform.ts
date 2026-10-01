import { z } from 'zod';
import { emailSchema, uuidSchema } from '../common/ids';
import { mfaRequiredSchema, tokenPairSchema } from './login';
import {
  otpSenderRefSchema,
  otpStatusSchema,
  otpTemplateOutcomeSchema,
  otpTemplateStateSchema,
} from './otp-senders';
import { authPageContentSchema } from './signup';

/** Platform-operator layer: `/v2/platform/*`. */

export const operatorRoleSchema = z.enum(['super_admin', 'support', 'auditor']);
export type OperatorRole = z.infer<typeof operatorRoleSchema>;

export const operatorSummarySchema = z.object({
  id: uuidSchema,
  email: z.string(),
  fullName: z.string(),
  role: operatorRoleSchema,
  mfaEnabled: z.boolean(),
});
export type OperatorSummary = z.infer<typeof operatorSummarySchema>;

export const operatorLoginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
  captchaToken: z.string().max(4096).optional(),
});
export type OperatorLoginRequest = z.infer<typeof operatorLoginRequestSchema>;

export const operatorAuthenticatedSchema = z.object({
  status: z.literal('authenticated'),
  tokens: tokenPairSchema,
  operator: operatorSummarySchema,
  /** Super admins must enrol MFA before using the console. */
  mfaEnrolmentRequired: z.boolean(),
});
export const operatorLoginResponseSchema = z.discriminatedUnion('status', [
  operatorAuthenticatedSchema,
  mfaRequiredSchema,
]);
export type OperatorLoginResponse = z.infer<typeof operatorLoginResponseSchema>;

export const operatorSessionResponseSchema = z.object({
  operator: operatorSummarySchema,
  mfaEnrolmentRequired: z.boolean(),
  sessionId: uuidSchema,
});
export type OperatorSessionResponse = z.infer<typeof operatorSessionResponseSchema>;

// --- registration policy and OTP (TW-AUTH-019, TW-AUTH-007) -------------------

export const registrationSettingsSchema = z.object({
  publicRegistration: z.boolean().default(true),
  /** off = auto-verify, banner = allowed but nagged, block = must verify first. */
  emailVerification: z.enum(['off', 'banner', 'block']).default('banner'),
  /** Plan slug from the PLAN domain; null = the domain's own default. */
  defaultPlanId: z.string().max(64).nullable().default(null),
  trialDays: z.number().int().min(0).max(365).default(14),
  defaultTimezone: z.string().max(64).default('UTC'),
  defaultCountryIso: z.string().length(2).nullable().default(null),
  termsUrl: z.string().max(512).default('/legal/terms'),
  privacyUrl: z.string().max(512).default('/legal/privacy'),
  cookiesUrl: z.string().max(512).nullable().default(null),
  otp: z
    .object({
      enabled: z.boolean().default(false),
      /** `<kind>:<id>` of a sender in the OTP sender registry (waba, twilio, device, dev). */
      sender: z.string().max(80).nullable().default(null),
      /**
       * The OTP message template for `sender`. Server-managed: created and refreshed through the
       * template endpoints, never written by the settings patch.
       */
      template: otpTemplateStateSchema.nullable().default(null),
      ttlMinutes: z.number().int().min(1).max(90).default(5),
      length: z.number().int().min(4).max(8).default(6),
      resendCooldownSec: z.number().int().min(15).max(600).default(60),
      maxAttempts: z.number().int().min(1).max(20).default(5),
    })
    .default({}),
});
export type RegistrationSettings = z.infer<typeof registrationSettingsSchema>;

const otpSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  /** Must be a sender in the OTP sender registry; null clears the choice. */
  sender: otpSenderRefSchema.nullable().optional(),
  ttlMinutes: z.number().int().min(1).max(90).optional(),
  length: z.number().int().min(4).max(8).optional(),
  resendCooldownSec: z.number().int().min(15).max(600).optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
});

export const registrationSettingsPatchSchema = z.object({
  publicRegistration: z.boolean().optional(),
  emailVerification: z.enum(['off', 'banner', 'block']).optional(),
  defaultPlanId: z.string().max(64).nullable().optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  defaultTimezone: z.string().max(64).optional(),
  defaultCountryIso: z.string().length(2).nullable().optional(),
  termsUrl: z.string().max(512).optional(),
  privacyUrl: z.string().max(512).optional(),
  cookiesUrl: z.string().max(512).nullable().optional(),
  otp: otpSettingsPatchSchema.optional(),
});
export type RegistrationSettingsPatch = z.infer<typeof registrationSettingsPatchSchema>;

/**
 * What GET and PATCH registration return: the stored settings plus the live
 * activation verdict (the same rule sign-up applies), so the screen can say why
 * the code step is or is not running.
 */
export const registrationSettingsResponseSchema = registrationSettingsSchema.extend({
  otpStatus: otpStatusSchema,
});
export type RegistrationSettingsResponse = z.infer<typeof registrationSettingsResponseSchema>;

/** "Create & submit template" posts the OTP form: the knobs are saved in the same request. */
export const otpTemplateCreateRequestSchema = z.object({
  otp: otpSettingsPatchSchema.default({}),
});
export type OtpTemplateCreateRequest = z.infer<typeof otpTemplateCreateRequestSchema>;

export const otpTemplateActionResponseSchema = z.object({
  outcome: otpTemplateOutcomeSchema,
  registration: registrationSettingsResponseSchema,
});
export type OtpTemplateActionResponse = z.infer<typeof otpTemplateActionResponseSchema>;

// --- social login and captcha (TW-AUTH-023) -------------------------------------

export const socialProviderSettingsSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string(),
  /** Secrets are write-only: the API reports whether one is stored, never the value. */
  hasSecret: z.boolean(),
  /** Enabled AND id AND secret all present: the button actually shows. */
  live: z.boolean(),
});

export const socialCaptchaSettingsResponseSchema = z.object({
  google: socialProviderSettingsSchema,
  facebook: socialProviderSettingsSchema,
  recaptcha: z.object({
    enabled: z.boolean(),
    version: z.enum(['v2', 'v3']),
    siteKey: z.string(),
    hasSecret: z.boolean(),
    v3Threshold: z.number().min(0).max(1),
    live: z.boolean(),
  }),
});
export type SocialCaptchaSettingsResponse = z.infer<typeof socialCaptchaSettingsResponseSchema>;

const secretPatch = z.string().max(255).optional();
export const socialCaptchaSettingsPatchSchema = z.object({
  google: z
    .object({
      enabled: z.boolean().optional(),
      clientId: z.string().max(255).optional(),
      /** Omitted or blank keeps the stored secret, so a save cannot wipe it. */
      clientSecret: secretPatch,
      /** Deletes the stored secret (and turns the provider off in effect). */
      clearSecret: z.boolean().optional(),
    })
    .optional(),
  facebook: z
    .object({
      enabled: z.boolean().optional(),
      clientId: z.string().max(255).optional(),
      clientSecret: secretPatch,
      clearSecret: z.boolean().optional(),
    })
    .optional(),
  recaptcha: z
    .object({
      enabled: z.boolean().optional(),
      version: z.enum(['v2', 'v3']).optional(),
      siteKey: z.string().max(255).optional(),
      secret: secretPatch,
      clearSecret: z.boolean().optional(),
      v3Threshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
});
export type SocialCaptchaSettingsPatch = z.infer<typeof socialCaptchaSettingsPatchSchema>;

// --- auth page editor (TW-AUTH-021/022) -------------------------------------------

/** Key names of the optional showcase copy that variant 1 renders. */
export const AUTH_PAGE_EXTRA_KEYS = [
  'hero_title',
  'hero_desc',
  'footer',
  'stat1_num',
  'stat1_label',
  'stat2_num',
  'stat2_label',
  'stat3_num',
  'stat3_label',
  'feat1_title',
  'feat1_desc',
  'feat2_title',
  'feat2_desc',
  'feat3_title',
  'feat3_desc',
  'feat4_title',
  'feat4_desc',
  'inside_heading',
  'chip1',
  'chip2',
  'chip3',
  'chip4',
  'chip5',
  'chip6',
] as const;

export const authPageExtraSchema = z.record(z.string().max(600));

export const authPagesResponseSchema = z.object({
  /** The shipped copy shown wherever a field is empty, so the editor need not mirror it. */
  defaults: z.object({
    login: authPageContentSchema,
    register: authPageContentSchema,
    forgot: authPageContentSchema,
  }),
  variant: z.number().int().min(1).max(5),
  login: authPageContentSchema,
  register: authPageContentSchema,
  forgot: authPageContentSchema,
  extra: z.object({
    login: authPageExtraSchema,
    register: authPageExtraSchema,
  }),
});
export type AuthPagesResponse = z.infer<typeof authPagesResponseSchema>;

/** In a patch an empty string means "clear this field, show the shipped default". */
const empty = z.literal('');
const httpsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((u) => u.startsWith('https://'), 'must be an https address');
export const authPageContentPatchSchema = z.object({
  eyebrow: z.string().max(120).optional(),
  heading: z.string().max(120).optional(),
  headingAccent: z.string().max(120).optional(),
  subheading: z.string().max(400).optional(),
  accent: z.union([empty, z.string().regex(/^#[0-9a-fA-F]{6}$/)]).optional(),
  mediaUrl: z.union([empty, httpsUrl]).optional(),
  mediaType: z.enum(['image', 'gif', 'video']).optional(),
});

export const authPagesPatchSchema = z.object({
  variant: z.number().int().min(1).max(5).optional(),
  login: authPageContentPatchSchema.optional(),
  register: authPageContentPatchSchema.optional(),
  forgot: authPageContentPatchSchema.optional(),
  extra: z
    .object({ login: authPageExtraSchema.optional(), register: authPageExtraSchema.optional() })
    .optional(),
  /** Clears the side media of these pages. */
  clearMedia: z.array(z.enum(['login', 'register', 'forgot'])).optional(),
});
export type AuthPagesPatch = z.infer<typeof authPagesPatchSchema>;
