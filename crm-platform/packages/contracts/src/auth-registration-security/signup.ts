import { z } from 'zod';
import { emailSchema, phoneSchema } from '../common/ids';
import { authenticatedSchema, orgSlugSchema, passwordSchema } from './login';

/**
 * Sign-up creates an organization and its first user together (WD-AUTH-005,
 * ADR-0019). There is no "global user first" step.
 */
export const signupRequestSchema = z.object({
  orgName: z.string().trim().min(2).max(120),
  /** Optional; derived from orgName when omitted. */
  orgSlug: orgSlugSchema.optional(),
  fullName: z.string().trim().min(1).max(120),
  email: emailSchema,
  /** E.164. Required only when registration OTP is active. */
  phone: phoneSchema.optional(),
  password: passwordSchema,
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms.' }) }),
  referralCode: z
    .string()
    .trim()
    .max(16)
    .regex(/^[A-Za-z0-9]*$/)
    .optional(),
  captchaToken: z.string().max(4096).optional(),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const otpRequiredSchema = z.object({
  status: z.literal('otp_required'),
  challengeId: z.string(),
  /** "+91 •••• ••21" — never the full number. */
  maskedPhone: z.string(),
  expiresInSeconds: z.number().int().positive(),
  resendCooldownSeconds: z.number().int().nonnegative(),
  codeLength: z.number().int().min(4).max(8),
});
export type OtpRequired = z.infer<typeof otpRequiredSchema>;

export const signupResponseSchema = z.discriminatedUnion('status', [
  authenticatedSchema,
  otpRequiredSchema,
]);
export type SignupResponse = z.infer<typeof signupResponseSchema>;

export const signupVerifyOtpRequestSchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().trim().min(4).max(8),
});
export type SignupVerifyOtpRequest = z.infer<typeof signupVerifyOtpRequestSchema>;

export const signupResendOtpRequestSchema = z.object({ challengeId: z.string().min(1) });
export type SignupResendOtpRequest = z.infer<typeof signupResendOtpRequestSchema>;

export const signupResendOtpResponseSchema = z.object({
  expiresInSeconds: z.number().int().positive(),
  resendCooldownSeconds: z.number().int().nonnegative(),
});

/** Public, unauthenticated: drives the guest pages (WD-AUTH-019/021/023). */
export const authPageContentSchema = z.object({
  eyebrow: z.string().max(120).optional(),
  heading: z.string().max(120).optional(),
  headingAccent: z.string().max(120).optional(),
  subheading: z.string().max(400).optional(),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  /** https URL; uploads move to object storage with the storage adapter. */
  mediaUrl: z
    .string()
    .url()
    .max(2048)
    .refine((u) => u.startsWith('https://'), 'must be an https address')
    .optional(),
  mediaType: z.enum(['image', 'gif', 'video']).optional(),
});
export type AuthPageContent = z.infer<typeof authPageContentSchema>;

export const authPageNameSchema = z.enum(['login', 'register', 'forgot']);
export type AuthPageName = z.infer<typeof authPageNameSchema>;

export const authPageTextFieldSchema = z.enum([
  'eyebrow',
  'heading',
  'headingAccent',
  'subheading',
]);
export type AuthPageTextField = z.infer<typeof authPageTextFieldSchema>;

export const registrationConfigResponseSchema = z.object({
  appName: z.string(),
  registrationOpen: z.boolean(),
  emailVerification: z.enum(['off', 'banner', 'block']),
  trialDays: z.number().int().nonnegative(),
  /** False when an administrator turned "keep me signed in" off; the checkbox is then hidden. */
  rememberMeEnabled: z.boolean(),
  otp: z.object({ enabled: z.boolean() }),
  captcha: z
    .object({ version: z.enum(['v2', 'v3']), siteKey: z.string() })
    .nullable()
    .describe('null when reCAPTCHA is off or incompletely configured'),
  social: z.object({ google: z.boolean(), facebook: z.boolean() }),
  defaultCountryIso: z.string().length(2).nullable(),
  authPages: z.object({
    variant: z.number().int().min(1).max(5),
    login: authPageContentSchema,
    register: authPageContentSchema,
    forgot: authPageContentSchema,
    /**
     * Fields the administrator left empty, for which the text above is the
     * platform's English default. A localised client swaps its own copy in.
     */
    defaulted: z.object({
      login: z.array(authPageTextFieldSchema),
      register: z.array(authPageTextFieldSchema),
      forgot: z.array(authPageTextFieldSchema),
    }),
    /** Optional showcase copy for the split layout (hero text, stats, feature chips). */
    extra: z.object({
      login: z.record(z.string().max(600)),
      register: z.record(z.string().max(600)),
    }),
  }),
  links: z.object({
    terms: z.string(),
    privacy: z.string(),
    cookies: z.string().nullable(),
  }),
});
export type RegistrationConfigResponse = z.infer<typeof registrationConfigResponseSchema>;
