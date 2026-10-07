import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { GATE_ROUTES, pathOf } from './gate-routes';

/**
 * The API refuses a gated account with one of five problem+json codes. Any
 * screen that calls the API can run its errors through these helpers to send
 * the person to the screen that resolves the gate, instead of showing a
 * generic failure.
 *
 *   AUTH_ACCOUNT_SUSPENDED          -> /suspended
 *   WSP_ORG_SUSPENDED               -> /suspended (the whole workspace is suspended by the platform)
 *   AUTH_PASSWORD_CHANGE_REQUIRED   -> /account/security?required=password
 *   AUTH_MFA_ENROLMENT_REQUIRED     -> /account/security?required=mfa
 *   AUTH_EMAIL_UNVERIFIED           -> /verify-email-required
 */
const TARGETS: Readonly<Record<string, string>> = {
  [ERROR_CODES.AUTH_ACCOUNT_SUSPENDED]: GATE_ROUTES.suspended,
  [ERROR_CODES.WSP_ORG_SUSPENDED]: GATE_ROUTES.suspended,
  [ERROR_CODES.AUTH_PASSWORD_CHANGE_REQUIRED]: GATE_ROUTES.passwordRequired,
  [ERROR_CODES.AUTH_MFA_ENROLMENT_REQUIRED]: GATE_ROUTES.mfaRequired,
  [ERROR_CODES.AUTH_EMAIL_UNVERIFIED]: GATE_ROUTES.verifyEmail,
};

/** The screen that resolves the gate a problem code stands for, or null for any other code. */
export function gateRouteForCode(code: string | undefined): string | null {
  return code ? (TARGETS[code] ?? null) : null;
}

/** True when the error is one of the four gate refusals. */
export function isGateError(error: unknown): error is ApiError {
  return error instanceof ApiError && gateRouteForCode(error.code) !== null;
}

/**
 * Where to send the person for this error, or null when it is not a gate error.
 * Pass `currentPath` so a page that already is the destination is not redirected
 * onto itself.
 */
export function gateRedirectFor(error: unknown, currentPath?: string): string | null {
  if (!(error instanceof ApiError)) return null;
  const target = gateRouteForCode(error.code);
  if (!target) return null;
  if (currentPath && pathOf(target) === pathOf(currentPath)) return null;
  return target;
}

/**
 * Convenience for catch blocks: redirects when the error is a gate error and
 * tells the caller whether it did, so the caller can skip its own error UI.
 *
 *   catch (e) { if (redirectOnGateError(e, router.replace)) return; ... }
 */
export function redirectOnGateError(
  error: unknown,
  replace: (href: string) => void,
  currentPath?: string,
): boolean {
  const target = gateRedirectFor(error, currentPath);
  if (!target) return false;
  replace(target);
  return true;
}
