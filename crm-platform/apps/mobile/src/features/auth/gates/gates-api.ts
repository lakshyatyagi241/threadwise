import {
  mfaEnableResponseSchema,
  mfaSetupResponseSchema,
  resendVerificationResponseSchema,
  type ChangePasswordRequest,
  type MfaEnableRequest,
  type MfaSetupRequest,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * The calls the lock screens make. The API leaves exactly these routes open while an account is gated (`@AllowWhileGated`). None of
 * them is idempotent on the server: the app's client sends an Idempotency-Key with every POST, but the API only honours it on routes
 * marked `@Idempotent`, and the account routes are not (the answers hold a secret, the authenticator key and the recovery codes, that
 * must never be stored for a replay). Do not mark them. Each is safe to ask again.
 */

/** Sends the verification email again (one a minute). */
export const resendVerification = () =>
  apiFetch('/v2/auth/verify-email/resend', {
    method: 'POST',
    schema: resendVerificationResponseSchema,
  });

/**
 * Changes the password (other devices are signed out, this one stays). A 2xx is the whole answer: the account's `forcePasswordChange`
 * is cleared and the next read of the session says so, so the body (a count of the devices signed out) is not read.
 */
export const changePassword = (body: ChangePasswordRequest) =>
  apiFetch('/v2/account/password', { method: 'POST', body });

/** Starts enrolling an authenticator app. A session older than ten minutes must send the password (403 AUTH_REAUTH_REQUIRED). */
export const startMfaSetup = (body: MfaSetupRequest) =>
  apiFetch('/v2/account/mfa/setup', { method: 'POST', body, schema: mfaSetupResponseSchema });

/** Confirms the first code and turns two-factor on; the answer holds the one-time recovery codes. */
export const enableMfa = (body: MfaEnableRequest) =>
  apiFetch('/v2/account/mfa/enable', { method: 'POST', body, schema: mfaEnableResponseSchema });
