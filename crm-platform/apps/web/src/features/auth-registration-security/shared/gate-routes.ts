/**
 * Where each account gate is resolved. One table, used by the (app) gate, the
 * lock-screen pages and the API-error mapper, so a destination can never be
 * named two different ways.
 */
export const GATE_ROUTES = {
  suspended: '/suspended',
  verifyEmail: '/verify-email-required',
  onboarding: '/onboarding',
  /** Enrolment and password screens live here; the API leaves these routes open while gated. */
  security: '/account/security',
  passwordRequired: '/account/security?required=password',
  mfaRequired: '/account/security?required=mfa',
  home: '/',
} as const;

/** The path part of a route, without its query string. */
export function pathOf(route: string): string {
  const q = route.indexOf('?');
  return q === -1 ? route : route.slice(0, q);
}

/** True when `pathname` is `base` or below it. */
export function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}
