import { z } from 'zod';
import { emailSchema } from '../common/ids';
import { orgSlugSchema, passwordSchema } from './login';

/** Always answered with the same neutral body (no account enumeration). */
export const neutralAckSchema = z.object({ ok: z.literal(true) });
export type NeutralAck = z.infer<typeof neutralAckSchema>;

export const forgotPasswordRequestSchema = z.object({
  orgSlug: orgSlugSchema,
  email: emailSchema,
  captchaToken: z.string().max(4096).optional(),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  orgSlug: orgSlugSchema,
  token: z.string().min(16).max(128),
  password: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/** Verification never signs anyone in (Reference's link did; this does not). */
export const verifyEmailRequestSchema = z.object({
  orgSlug: orgSlugSchema,
  token: z.string().min(16).max(128),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

/**
 * `POST /v2/auth/verify-email/resend`. When the mail could not be sent, `reason`
 * says why in a closed vocabulary that never carries secrets (TW-AUTH-015); a
 * failed send does not start the 60-second wait.
 */
export const mailFailureReasonSchema = z.enum([
  'not_configured',
  'auth_failed',
  'connection_refused',
  'timeout',
  'transport_error',
  'unknown',
]);
export type MailFailureReasonCode = z.infer<typeof mailFailureReasonSchema>;

export const resendVerificationResponseSchema = z.object({
  sent: z.boolean(),
  alreadyVerified: z.boolean(),
  reason: mailFailureReasonSchema.optional(),
});
export type ResendVerificationResponse = z.infer<typeof resendVerificationResponseSchema>;

/** Email-only entry: mails the workspace slugs to verified addresses. */
export const findWorkspacesRequestSchema = z.object({
  email: emailSchema,
  captchaToken: z.string().max(4096).optional(),
});
export type FindWorkspacesRequest = z.infer<typeof findWorkspacesRequestSchema>;

export const socialProviderSchema = z.enum(['google', 'facebook']);
export type SocialProvider = z.infer<typeof socialProviderSchema>;

export const socialStartQuerySchema = z.object({
  /** Existing workspace to sign in to, or omit with mode=signup. */
  orgSlug: orgSlugSchema.optional(),
  mode: z.enum(['login', 'signup']).default('login'),
  /** Where the provider redirects back to: must be an allowed web origin. */
  redirectUri: z.string().url().max(512),
  /** Required for mode=signup. */
  orgName: z.string().trim().min(2).max(120).optional(),
});
export type SocialStartQuery = z.infer<typeof socialStartQuerySchema>;

export const socialStartResponseSchema = z.object({ url: z.string().url() });

export const socialCallbackRequestSchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(16).max(128),
});
export type SocialCallbackRequest = z.infer<typeof socialCallbackRequestSchema>;
