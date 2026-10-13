import { z } from 'zod';
import { emailSchema, phoneSchema, uuidSchema } from '../common/ids';
import { cursorSchema, pageResponseSchema } from '../common/pagination';

/** Self-service account screens (TW-AUTH-024..031). */

/**
 * Longest outgoing-message footer, in characters. Reference validates with
 * `mb_strlen`, so an emoji costs one, not the two UTF-16 units `String.length`
 * reports: measure with `footerLength`, never `.length`.
 */
export const BRANDING_FOOTER_MAX = 60;
export const footerLength = (s: string): number => Array.from(s).length;

/** A footer text: trimmed, at most BRANDING_FOOTER_MAX characters (code points). '' = none. */
export const brandingFooterTextSchema = z
  .string()
  .trim()
  .refine((s) => footerLength(s) <= BRANDING_FOOTER_MAX, {
    message: `Use at most ${BRANDING_FOOTER_MAX} characters.`,
  });

export const profileResponseSchema = z.object({
  fullName: z.string(),
  displayName: z.string().nullable(),
  email: z.string(),
  emailVerified: z.boolean(),
  /** Set while an email change awaits confirmation from the new address. */
  pendingEmail: z.string().nullable(),
  phone: z.string().nullable(),
  locale: z.string().nullable(),
  /** The person's own time zone; null = follow the workspace. */
  timezone: z.string().nullable(),
  /** The zone dates are shown in: the person's own, else the workspace's, else UTC. */
  effectiveTimezone: z.string(),
  theme: z.enum(['paper', 'bright', 'dark']),
  avatarUrl: z.string().nullable(),
  /**
   * The largest photo the server stores, in bytes (always sent). A client that
   * shrinks photos before upload keeps an animated GIF as it is when it fits.
   */
  avatarMaxBytes: z.number().int().positive().optional(),
  /** The workspace's timezone, shown to every member (read-only unless `canEditWorkspaceTimezone`). */
  workspaceTimezone: z.string().nullable(),
  /**
   * The workspace owner (or, for a workspace with no recorded owner, an
   * administrator) can change it. Everyone else may still post the field: it is
   * ignored without an error, as in Reference, and the unchanged value comes back.
   */
  canEditWorkspaceTimezone: z.boolean(),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

export const updateProfileRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  /** Blank clears it. */
  displayName: z.string().trim().max(120).nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  locale: z.string().min(2).max(12).nullable().optional(),
  /** The person's own time zone (an IANA name); null goes back to the workspace's. */
  timezone: z.string().min(1).max(64).nullable().optional(),
  theme: z.enum(['paper', 'bright', 'dark']).optional(),
  /** Ignored (not an error) when the caller may not change it; see `canEditWorkspaceTimezone`. */
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
  /**
   * Bounds only. The floor is 8 because the administrator's policy minimum is
   * allowed down to 8; the server enforces the stored policy (and reports every
   * broken rule as AUTH_PASSWORD_POLICY), so the contract must never be stricter than it.
   */
  newPassword: z.string().min(8).max(256),
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
  /**
   * What this workspace saved: null = nothing saved, '' = deliberately no footer.
   * On a plan that removes branding both send no footer (the platform default is
   * never a fallback there); on any other plan the saved text is ignored.
   */
  messageFooter: z.string().nullable(),
  platformDefault: z.string(),
  /** False on plans without the remove_branding feature. */
  canEdit: z.boolean(),
  /**
   * The footer the next outgoing text message carries, resolved exactly as the
   * send path resolves it: null = none. Template messages never carry one.
   */
  effective: z.string().nullable(),
});
export type BrandingResponse = z.infer<typeof brandingResponseSchema>;

export const updateBrandingRequestSchema = z.object({
  messageFooter: brandingFooterTextSchema.nullable(),
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

/**
 * Starting or finishing two-factor enrolment needs recent authentication: a session that signed in less than this long ago
 * is trusted as is, an older one must send the password again (otherwise a hijacked session could enrol the attacker's
 * authenticator and lock the owner out). Seconds.
 */
export const MFA_REAUTH_WINDOW_SECONDS = 600;

export const mfaSetupRequestSchema = z
  .object({ password: z.string().min(1).max(256).optional() })
  .default({});
export type MfaSetupRequest = z.infer<typeof mfaSetupRequestSchema>;

export const mfaEnableRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  /** Only needed when the session is older than MFA_REAUTH_WINDOW_SECONDS (the API answers AUTH_REAUTH_REQUIRED). */
  password: z.string().min(1).max(256).optional(),
});
export type MfaEnableRequest = z.infer<typeof mfaEnableRequestSchema>;

export const mfaEnableResponseSchema = z.object({
  /** Shown exactly once. */
  recoveryCodes: z.array(z.string()),
});
export type MfaEnableResponse = z.infer<typeof mfaEnableResponseSchema>;

/** Turning two-factor off needs the password AND a current authenticator code or an unused recovery code. */
export const mfaDisableRequestSchema = z.object({
  password: z.string().min(1).max(256),
  code: z.string().trim().min(6).max(16),
});
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

/** What the devices screen states about how long a sign-in lasts, so it never hard-codes it. */
export const sessionListMetaSchema = z.object({
  /** Absolute lifetime of a session signed in without "keep me signed in". */
  sessionLifetimeSeconds: z.number().int().positive(),
  /** Absolute lifetime of a remembered session. */
  rememberLifetimeSeconds: z.number().int().positive(),
  /** Idle minutes after which a non-remembered session ends. 0 = no idle limit. */
  idleTimeoutMinutes: z.number().int().nonnegative(),
});
export type SessionListMeta = z.infer<typeof sessionListMetaSchema>;

export const sessionListQuerySchema = z.object({
  /** Reference shows ten devices per page. */
  limit: z.coerce.number().int().min(1).max(100).default(10),
  cursor: cursorSchema.optional(),
});
export type SessionListQuery = z.infer<typeof sessionListQuerySchema>;

/**
 * One page of `GET /v2/account/sessions` (`?limit=` 1-100, default 10, `?cursor=`):
 * the current device leads the first page, `total` counts every live session
 * ("showing 1-10 of 23"), `meta` carries the lifetimes for the subtitle.
 */
export const sessionListResponseSchema = pageResponseSchema(sessionItemSchema).extend({
  total: z.number().int().nonnegative(),
  meta: sessionListMetaSchema,
});
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;

export const revokeOthersResponseSchema = z.object({ revoked: z.number().int().nonnegative() });
