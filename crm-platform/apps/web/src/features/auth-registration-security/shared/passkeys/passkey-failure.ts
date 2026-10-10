import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/**
 * Why a passkey step failed, from the two places it can fail: the API (a problem+json `code`) and the browser's
 * WebAuthn prompt (a `DOMException`, which `@simplewebauthn/browser` wraps with a `code` and keeps the original `name`).
 * Screens branch on this and show their own translated text; nothing here reads a message.
 */
export type PasskeyFailure =
  /** The person closed the prompt, or it timed out: not an error worth shouting about. */
  | 'cancelled'
  /** This authenticator already holds a passkey for the account. */
  | 'alreadyRegistered'
  /** The device or browser cannot make or use this kind of credential. */
  | 'unsupported'
  /** Two-factor is off (409): turn it on first. */
  | 'needsMfa'
  /** The session is older than the re-authentication window (403): send the password. */
  | 'reauth'
  | 'wrongPassword'
  /** The server did not accept the browser's answer (wrong origin, challenge, signature). */
  | 'invalid'
  /** The account holds the most passkeys it may. */
  | 'limit'
  /** The passkey is already gone (removed on another device). */
  | 'notFound'
  /** The sign-in challenge lapsed: the person starts again from the password. */
  | 'challengeExpired'
  | 'other';

const CANCELLED_NAMES = new Set(['NotAllowedError', 'AbortError']);
const UNSUPPORTED_CODES = new Set([
  'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG',
  'ERROR_MALFORMED_PUBKEYCREDPARAMS',
  'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT',
  'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT',
]);

const BY_API_CODE: Readonly<Record<string, PasskeyFailure>> = {
  [ERROR_CODES.AUTH_PASSKEY_NEEDS_MFA]: 'needsMfa',
  [ERROR_CODES.AUTH_REAUTH_REQUIRED]: 'reauth',
  [ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG]: 'wrongPassword',
  [ERROR_CODES.AUTH_PASSKEY_INVALID]: 'invalid',
  [ERROR_CODES.AUTH_PASSKEY_LIMIT]: 'limit',
  [ERROR_CODES.AUTH_MFA_CHALLENGE_EXPIRED]: 'challengeExpired',
  [ERROR_CODES.NOT_FOUND]: 'notFound',
};

export function classifyPasskeyError(error: unknown): PasskeyFailure {
  if (error instanceof ApiError) return BY_API_CODE[error.code] ?? 'other';
  if (!(error instanceof Error)) return 'other';
  const code = (error as { code?: unknown }).code;
  if (code === 'ERROR_CEREMONY_ABORTED' || CANCELLED_NAMES.has(error.name)) return 'cancelled';
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || error.name === 'InvalidStateError') {
    return 'alreadyRegistered';
  }
  if (
    error.name === 'NotSupportedError' ||
    (typeof code === 'string' && UNSUPPORTED_CODES.has(code))
  ) {
    return 'unsupported';
  }
  return 'other';
}
