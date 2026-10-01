import type { AccountFlags, Landing } from '@crm/contracts';
import { GATE_ROUTES, isUnder, pathOf } from '../shared/gate-routes';

export interface GateInput {
  pathname: string;
  flags: AccountFlags;
  landing: Landing;
}

/**
 * Which screen a gated account must be on, or null when `pathname` is fine
 * (WD-AUTH-016/032/035). Order matches the API guard: suspended, forced
 * password change, required MFA enrolment, unverified email, unfinished setup.
 *
 * Every destination is exempt from its own gate: the suspended page, the
 * security screens (the API leaves password, MFA and device routes open while
 * gated), the verify-email page and onboarding. WaDesk's Force2FA sent people
 * to a page its own allow-list did not exempt, an endless redirect; the
 * property test in gate-target.test.ts keeps that from coming back.
 */
export function gateTarget({ pathname, flags, landing }: GateInput): string | null {
  if (flags.suspended) return pathname === GATE_ROUTES.suspended ? null : GATE_ROUTES.suspended;

  if (flags.passwordChangeRequired) {
    return isUnder(pathname, GATE_ROUTES.security) ? null : GATE_ROUTES.passwordRequired;
  }
  if (flags.mfaEnrolmentRequired) {
    return isUnder(pathname, GATE_ROUTES.security) ? null : GATE_ROUTES.mfaRequired;
  }

  if (flags.emailBlocked) {
    // First-run setup stays reachable while the email is unverified (the API allows it too).
    const exempt =
      pathname === GATE_ROUTES.verifyEmail || isUnder(pathname, GATE_ROUTES.onboarding);
    return exempt ? null : GATE_ROUTES.verifyEmail;
  }

  // `landing` is 'onboarding' only for the person who can finish setup (an administrator).
  if (landing === 'onboarding') {
    const exempt =
      isUnder(pathname, GATE_ROUTES.onboarding) ||
      isUnder(pathname, '/account') ||
      pathname === GATE_ROUTES.suspended ||
      pathname === GATE_ROUTES.verifyEmail;
    return exempt ? null : GATE_ROUTES.onboarding;
  }
  return null;
}

export type GatePage = 'suspended' | 'verifyEmail' | 'onboarding';

const PAGE_PATH: Record<GatePage, string> = {
  suspended: GATE_ROUTES.suspended,
  verifyEmail: GATE_ROUTES.verifyEmail,
  onboarding: GATE_ROUTES.onboarding,
};

/**
 * What a lock-screen page does with the current account state: redirect to
 * another gate that outranks it, or leave to the home router when its own gate
 * does not apply (any more). Null = stay.
 */
export function gatePageRedirect(
  page: GatePage,
  input: Omit<GateInput, 'pathname'>,
): string | null {
  const other = gateTarget({ ...input, pathname: PAGE_PATH[page] });
  if (other) return pathOf(other) === PAGE_PATH[page] ? null : other;

  const applies =
    page === 'suspended'
      ? input.flags.suspended
      : page === 'verifyEmail'
        ? input.flags.emailBlocked
        : input.landing === 'onboarding';
  return applies ? null : GATE_ROUTES.home;
}
