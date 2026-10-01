import {
  authenticatedSchema,
  brandingResponseSchema,
  mfaEnableResponseSchema,
  mfaRequiredSchema,
  mfaSetupResponseSchema,
  mfaStatusResponseSchema,
  onboardingResponseSchema,
  plansResponseSchema,
  profileResponseSchema,
  revokeOthersResponseSchema,
  sessionListResponseSchema,
  sessionResponseSchema,
  workspaceListResponseSchema,
  type ChangeEmailRequest,
  type ChangePasswordRequest,
  type DeleteAccountRequest,
  type MfaRequired,
  type OnboardingWorkspaceRequest,
  type UpdateBrandingRequest,
  type UpdateProfileRequest,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';

/**
 * Every call the account hub, lock screens and onboarding make. Shapes come
 * from @crm/contracts; the three tiny responses the contract does not describe
 * (`{ok}`, the avatar URL, the password-change count, the resend result) are
 * declared here until they are added there.
 */

const okSchema = z.object({ ok: z.literal(true) });
const avatarSchema = z.object({ avatarUrl: z.string() });
const changePasswordResponseSchema = z.object({
  revokedOtherSessions: z.number().int().nonnegative(),
});
const resendVerificationSchema = z.object({ sent: z.boolean(), alreadyVerified: z.boolean() });

export const keys = {
  profile: ['auth', 'profile'] as const,
  branding: ['auth', 'branding'] as const,
  mfa: ['auth', 'mfa'] as const,
  sessions: ['auth', 'sessions'] as const,
  workspaces: ['auth', 'workspaces'] as const,
  onboarding: ['auth', 'onboarding'] as const,
  plans: ['plans'] as const,
  registrationConfig: ['auth', 'registration-config'] as const,
};

export const authApi = {
  session: () => apiFetch('/auth/session', { schema: sessionResponseSchema }),
  workspaces: () => apiFetch('/auth/workspaces', { schema: workspaceListResponseSchema }),
  resendVerification: () =>
    apiFetch('/auth/verify-email/resend', {
      method: 'POST',
      body: {},
      schema: resendVerificationSchema,
    }),

  onboarding: () => apiFetch('/onboarding', { schema: onboardingResponseSchema }),
  saveWorkspace: (body: OnboardingWorkspaceRequest) =>
    apiFetch('/onboarding/workspace', { method: 'POST', body, schema: onboardingResponseSchema }),
  completeOnboarding: () =>
    apiFetch('/onboarding/complete', {
      method: 'POST',
      body: {},
      schema: onboardingResponseSchema,
    }),

  plans: () => apiFetch('/plans', { schema: plansResponseSchema }),

  profile: () => apiFetch('/account/profile', { schema: profileResponseSchema }),
  updateProfile: (body: UpdateProfileRequest) =>
    apiFetch('/account/profile', { method: 'PATCH', body, schema: profileResponseSchema }),
  requestEmailChange: (body: ChangeEmailRequest) =>
    apiFetch('/account/email-change', { method: 'POST', body, schema: okSchema }),
  removeAvatar: () => apiFetch('/account/avatar', { method: 'DELETE', schema: okSchema }),
  changePassword: (body: ChangePasswordRequest) =>
    apiFetch('/account/password', { method: 'POST', body, schema: changePasswordResponseSchema }),
  deleteAccount: (body: DeleteAccountRequest) =>
    apiFetch('/account', { method: 'DELETE', body, schema: okSchema }),

  branding: () => apiFetch('/account/branding', { schema: brandingResponseSchema }),
  updateBranding: (body: UpdateBrandingRequest) =>
    apiFetch('/account/branding', { method: 'PATCH', body, schema: brandingResponseSchema }),

  mfaStatus: () => apiFetch('/account/mfa', { schema: mfaStatusResponseSchema }),
  mfaSetup: () =>
    apiFetch('/account/mfa/setup', { method: 'POST', body: {}, schema: mfaSetupResponseSchema }),
  mfaEnable: (code: string) =>
    apiFetch('/account/mfa/enable', {
      method: 'POST',
      body: { code },
      schema: mfaEnableResponseSchema,
    }),
  mfaDisable: (password: string) =>
    apiFetch('/account/mfa/disable', { method: 'POST', body: { password }, schema: okSchema }),
  regenerateRecoveryCodes: (password: string) =>
    apiFetch('/account/mfa/recovery-codes', {
      method: 'POST',
      body: { password },
      schema: mfaEnableResponseSchema,
    }),

  sessions: () => apiFetch('/account/sessions', { schema: sessionListResponseSchema }),
  revokeSession: (id: string) =>
    apiFetch(`/account/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', schema: okSchema }),
  revokeOtherSessions: () =>
    apiFetch('/account/sessions/revoke-others', {
      method: 'POST',
      body: {},
      schema: revokeOthersResponseSchema,
    }),
};

/**
 * Uploads the avatar as multipart (`file`). `apiFetch` only speaks JSON, so this
 * follows its conventions by hand: same-origin proxy, request id, idempotency key.
 */
export async function uploadAvatar(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/v2/account/avatar', {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'X-Request-Id': crypto.randomUUID(),
      'Idempotency-Key': crypto.randomUUID(),
    },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return avatarSchema.parse(json).avatarUrl;
}

/**
 * What the session-issuing BFF routes return: the contract body without the
 * token pair (the server moves it into httpOnly cookies). Unions are
 * picked by hand: composing contract schemas with this app's own `zod` import
 * mixes two builds of zod (CJS contracts, ESM web) and `z.discriminatedUnion`
 * cannot read the other build's literals.
 */
export const bffAuthenticatedSchema = authenticatedSchema.omit({ tokens: true });
export type BffAuthenticated = z.infer<typeof bffAuthenticatedSchema>;
export type BffSwitchResult = BffAuthenticated | MfaRequired;

export const bffSwitchResultSchema = {
  parse(json: unknown): BffSwitchResult {
    const status =
      typeof json === 'object' && json !== null ? (json as { status?: unknown }).status : undefined;
    return status === 'mfa_required'
      ? mfaRequiredSchema.parse(json)
      : bffAuthenticatedSchema.parse(json);
  },
};

/**
 * Session-issuing calls go through the BFF routes, which keep the tokens in
 * httpOnly cookies and return only what the page needs.
 */
export async function bffPost<T>(
  action: 'switch' | 'mfa',
  body: Record<string, unknown>,
  schema: { parse(json: unknown): T },
): Promise<T> {
  const res = await fetch(`/api/auth/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return schema.parse(json);
}
