import { z } from 'zod';
import { phoneSchema } from '../common/ids';

/**
 * Sign in with a mobile number and a one-time code. The code goes to the number the same way the sign-up code does (the
 * platform's registration OTP sender), so this is only offered while that step is active (`registrationConfig.otp.enabled`).
 * Only a number that was verified on an account can sign in. What the person gets after the right code is the same as after
 * a right password: a session, a second-factor challenge, or the list of workspaces to pick from (`passwordLoginResponseSchema`).
 */

/** `POST /v2/auth/login/phone`: asks for a code. */
export const phoneLoginStartRequestSchema = z.object({
  /** E.164. */
  phone: phoneSchema,
  /** "Keep me signed in": longer refresh lifetime, exempt from idle timeout. */
  remember: z.boolean().default(false),
  /** reCAPTCHA v2 `g-recaptcha-response` or v3 token. */
  captchaToken: z.string().max(4096).optional(),
});
export type PhoneLoginStartRequest = z.infer<typeof phoneLoginStartRequestSchema>;

/**
 * The answer is the same for a number that has an account and one that has none, so it cannot be used to find out who is a
 * customer: the code simply never arrives for the second.
 */
export const phoneLoginChallengeSchema = z.object({
  challengeId: z.string().min(1),
  /** "+91 •••• ••21": never the full number. */
  maskedPhone: z.string(),
  expiresInSeconds: z.int().positive(),
  resendCooldownSeconds: z.int().nonnegative(),
  codeLength: z.int().min(4).max(8),
});
export type PhoneLoginChallenge = z.infer<typeof phoneLoginChallengeSchema>;

/** `POST /v2/auth/login/phone/verify`: the code, answered like a password sign-in. */
export const phoneLoginVerifyRequestSchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().trim().min(4).max(8),
});
export type PhoneLoginVerifyRequest = z.infer<typeof phoneLoginVerifyRequestSchema>;

/** `POST /v2/auth/login/phone/resend`: a new code for the same challenge (a cooldown applies). */
export const phoneLoginResendRequestSchema = z.object({ challengeId: z.string().min(1) });
export type PhoneLoginResendRequest = z.infer<typeof phoneLoginResendRequestSchema>;

export const phoneLoginResendResponseSchema = z.object({
  expiresInSeconds: z.int().positive(),
  resendCooldownSeconds: z.int().nonnegative(),
});
export type PhoneLoginResendResponse = z.infer<typeof phoneLoginResendResponseSchema>;
