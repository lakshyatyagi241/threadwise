import { z } from 'zod';
import { emailSchema } from '../common/ids';

/**
 * Shapes shared by every flow that ends in "you now have a session": password
 * login, MFA step-up, social sign-in, sign-up, workspace switch.
 */

/** Seconds until the access token expires (never the raw TTL string). */
export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const orgSlugSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'letters, numbers, dash and underscore only');

/**
 * Plain bounds only. The admin password policy (TW-AUTH-035) is evaluated by
 * the server and reported as AUTH_PASSWORD_POLICY with per-rule details,
 * because the rules are runtime configuration, not part of the contract.
 */
export const passwordSchema = z.string().min(8).max(256);

/**
 * What the client must do after a successful authentication. The web app
 * routes on this; it never inspects tokens.
 */
export const landingSchema = z.enum(['dashboard', 'inbox', 'onboarding']);
export type Landing = z.infer<typeof landingSchema>;

export const accountFlagsSchema = z.object({
  /** Account suspended by an administrator: only sign out is possible. */
  suspended: z.boolean(),
  /** Email not verified yet (policy 'banner' nags, 'block' gates). */
  emailUnverified: z.boolean(),
  /** Policy 'block' and unverified: the API refuses everything except verification. */
  emailBlocked: z.boolean(),
  /** Policy requires MFA for this user and they have not enrolled. */
  mfaEnrolmentRequired: z.boolean(),
  /** Admin forced a reset, or the password is older than the max age. */
  passwordChangeRequired: z.boolean(),
});
export type AccountFlags = z.infer<typeof accountFlagsSchema>;

export const loginRequestSchema = z.object({
  /** Optional: when absent the server finds the workspace from the email (Reference signs in with email + password only). */
  orgSlug: orgSlugSchema.optional(),
  email: emailSchema,
  password: z.string().min(1).max(256),
  /** "Keep me signed in": longer refresh lifetime, exempt from idle timeout. */
  remember: z.boolean().default(false),
  /** reCAPTCHA v2 `g-recaptcha-response` or v3 token. */
  captchaToken: z.string().max(4096).optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authenticatedSchema = z.object({
  status: z.literal('authenticated'),
  /** Slug of the organization the session belongs to; the web app remembers it for the next sign-in. */
  orgSlug: orgSlugSchema,
  tokens: tokenPairSchema,
  landing: landingSchema,
  flags: accountFlagsSchema,
});
export type Authenticated = z.infer<typeof authenticatedSchema>;

export const mfaRequiredSchema = z.object({
  status: z.literal('mfa_required'),
  /** Single-use, expires in expiresInSeconds. Not a token pair. */
  challengeToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type MfaRequired = z.infer<typeof mfaRequiredSchema>;

export const loginResponseSchema = z.discriminatedUnion('status', [
  authenticatedSchema,
  mfaRequiredSchema,
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const mfaLoginRequestSchema = z
  .object({
    challengeToken: z.string().min(1),
    /** Six-digit authenticator code. */
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    /** One of the single-use recovery codes. */
    recoveryCode: z.string().min(8).max(32).optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    message: 'send either code or recoveryCode',
  });
export type MfaLoginRequest = z.infer<typeof mfaLoginRequestSchema>;

export const refreshRequestSchema = z.object({ refreshToken: z.string().min(1) });
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const logoutRequestSchema = z.object({
  /** Optional: when omitted the session in the access token is ended. */
  refreshToken: z.string().min(1).optional(),
});
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
