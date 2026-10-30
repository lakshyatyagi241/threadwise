import { z } from 'zod';

/**
 * Verifying the mobile number on the signed-in person's own profile with a one-time code, so that number can be used to sign in
 * (`phone-login.ts`). The code goes to the number saved on the profile at that moment, through the same sender as the sign-up code,
 * and only that number is marked verified: changing the number afterwards clears it again.
 */

/** `POST /v2/account/phone/verification`: sends a code to the number on the profile. */
export const phoneVerificationChallengeSchema = z.object({
  /** "+91 •••• ••21": never the full number. */
  maskedPhone: z.string(),
  expiresInSeconds: z.int().positive(),
  resendCooldownSeconds: z.int().nonnegative(),
  codeLength: z.int().min(4).max(8),
});
export type PhoneVerificationChallenge = z.infer<typeof phoneVerificationChallengeSchema>;

/** `POST /v2/account/phone/verification/confirm`. */
export const phoneVerificationConfirmRequestSchema = z.object({
  code: z.string().trim().min(4).max(8),
});
export type PhoneVerificationConfirmRequest = z.infer<typeof phoneVerificationConfirmRequestSchema>;

export const phoneVerificationConfirmResponseSchema = z.object({ verified: z.literal(true) });
export type PhoneVerificationConfirmResponse = z.infer<
  typeof phoneVerificationConfirmResponseSchema
>;

/** `POST /v2/account/phone/verification/resend` (a cooldown applies). */
export const phoneVerificationResendResponseSchema = z.object({
  expiresInSeconds: z.int().positive(),
  resendCooldownSeconds: z.int().nonnegative(),
});
export type PhoneVerificationResendResponse = z.infer<typeof phoneVerificationResendResponseSchema>;
