import { z } from 'zod';
import { emailSchema, phoneSchema, uuidSchema } from '../common/ids';
import { passwordSchema } from './login';

/** Self-service account screens (WD-AUTH-024..031). */

export const profileResponseSchema = z.object({
  fullName: z.string(),
  displayName: z.string().nullable(),
  email: z.string(),
  emailVerified: z.boolean(),
  /** Set while an email change awaits confirmation from the new address. */
  pendingEmail: z.string().nullable(),
  phone: z.string().nullable(),
  locale: z.string().nullable(),
  theme: z.enum(['paper', 'bright', 'dark']),
  avatarUrl: z.string().nullable(),
  /** Owners and admins can edit the workspace timezone from here. */
  workspaceTimezone: z.string().nullable(),
  canEditWorkspaceTimezone: z.boolean(),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

export const updateProfileRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  /** Blank clears it. */
  displayName: z.string().trim().max(120).nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  locale: z.string().min(2).max(12).nullable().optional(),
  theme: z.enum(['paper', 'bright', 'dark']).optional(),
  workspaceTimezone: z.string().min(1).max(64).optional(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const changeEmailRequestSchema = z.object({
  newEmail: emailSchema,
  /** Re-entered because the new address becomes the login id. */
  password: z.string().min(1).max(256),
});
export type ChangeEmailRequest = z.infer<typeof changeEmailRequestSchema>;

export const confirmEmailChangeRequestSchema = z.object({
  orgSlug: z.string().min(2).max(40),
  token: z.string().min(16).max(128),
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const DELETE_CONFIRMATION_PHRASE = 'DELETE my account';

export const deleteAccountRequestSchema = z.object({
  /** Must equal DELETE_CONFIRMATION_PHRASE exactly (case-sensitive). */
  confirmation: z.string(),
  password: z.string().min(1).max(256),
});
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

export const brandingResponseSchema = z.object({
  /** null = platform default, '' = no footer. */
  messageFooter: z.string().nullable(),
  platformDefault: z.string(),
  /** False on plans without the remove_branding feature. */
  canEdit: z.boolean(),
});
export type BrandingResponse = z.infer<typeof brandingResponseSchema>;

export const updateBrandingRequestSchema = z.object({
  messageFooter: z.string().trim().max(60).nullable(),
});
export type UpdateBrandingRequest = z.infer<typeof updateBrandingRequestSchema>;

// --- MFA -----------------------------------------------------------------------

export const mfaStatusResponseSchema = z.object({
  enabled: z.boolean(),
  confirmedAt: z.string().datetime().nullable(),
  recoveryCodesRemaining: z.number().int().nonnegative(),
  /** Policy says this user must enrol. */
  required: z.boolean(),
});
export type MfaStatusResponse = z.infer<typeof mfaStatusResponseSchema>;

export const mfaSetupResponseSchema = z.object({
  /** Base32, for manual entry. Rendered as a QR in the browser, never sent to a third party. */
  secret: z.string(),
  otpauthUrl: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;

export const mfaEnableRequestSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export type MfaEnableRequest = z.infer<typeof mfaEnableRequestSchema>;

export const mfaEnableResponseSchema = z.object({
  /** Shown exactly once. */
  recoveryCodes: z.array(z.string()),
});
export type MfaEnableResponse = z.infer<typeof mfaEnableResponseSchema>;

export const mfaDisableRequestSchema = z.object({ password: z.string().min(1).max(256) });
export type MfaDisableRequest = z.infer<typeof mfaDisableRequestSchema>;

export const regenerateRecoveryCodesRequestSchema = z.object({
  password: z.string().min(1).max(256),
});

// --- sessions ---------------------------------------------------------------------

export const sessionItemSchema = z.object({
  id: uuidSchema,
  current: z.boolean(),
  /** Parsed from the user agent, e.g. "Chrome on Windows". */
  device: z.string(),
  deviceKind: z.enum(['desktop', 'mobile', 'unknown']),
  ip: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime(),
  remember: z.boolean(),
});
export type SessionItem = z.infer<typeof sessionItemSchema>;

export const sessionListResponseSchema = z.object({ data: z.array(sessionItemSchema) });
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

export const revokeOthersResponseSchema = z.object({ revoked: z.number().int().nonnegative() });
