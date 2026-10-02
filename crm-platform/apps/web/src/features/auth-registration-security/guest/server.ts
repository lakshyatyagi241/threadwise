import 'server-only';
import {
  passwordPolicyHintSchema,
  registrationConfigResponseSchema,
  type AuthPageTextField,
  type PasswordPolicyHint,
  type RegistrationConfigResponse,
} from '@crm/contracts';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';
import { ORG_COOKIE } from '@/lib/auth/cookies';
import { apiBase, getOperatorSession, getSession, homePathFor } from '@/lib/auth/server';
import type { FixedPanel } from './auth-shell';
import { REFERRAL_COOKIE, referralFromParam } from './referral';

/**
 * What the guest pages need from the server: the public configuration (copy, design, captcha,
 * social buttons, sign-up policy) and the "already signed in" redirect (TW-AUTH-011).
 */

/** Used when the API cannot be reached: the pages still render, with built-in copy and no optional features. */
const ALL_TEXT = [
  'eyebrow',
  'heading',
  'headingAccent',
  'subheading',
] as const satisfies readonly AuthPageTextField[];

export const FALLBACK_CONFIG: RegistrationConfigResponse = {
  appName: '',
  registrationOpen: true,
  emailVerification: 'off',
  trialDays: 0,
  rememberMeEnabled: true,
  otp: { enabled: false },
  captcha: null,
  social: { google: false, facebook: false },
  defaultCountryIso: null,
  authPages: {
    variant: 1,
    login: {},
    register: {},
    forgot: {},
    // Nothing came from the API: every text field falls back to the page's own localised copy.
    defaulted: { login: [...ALL_TEXT], register: [...ALL_TEXT], forgot: [...ALL_TEXT] },
    extra: { login: {}, register: {}, forgot: {} },
  },
  links: { terms: '/legal/terms', privacy: '/legal/privacy', cookies: null },
};

/** Once per request: the layout (title, consent link) and the page both ask for it. */
export const loadRegistrationConfig = cache(async (): Promise<RegistrationConfigResponse> =>
  fetchRegistrationConfig(),
);

async function fetchRegistrationConfig(): Promise<RegistrationConfigResponse> {
  try {
    const res = await fetch(`${apiBase()}/v2/auth/registration-config`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return FALLBACK_CONFIG;
    const parsed = registrationConfigResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : FALLBACK_CONFIG;
  } catch {
    return FALLBACK_CONFIG;
  }
}

/**
 * The password rules in force right now (`GET /v2/auth/password-policy`, public), for the hint under a new-password
 * field. Null when the API cannot be reached: the form then shows a hint without a number.
 */
export const loadPasswordPolicy = cache(async (): Promise<PasswordPolicyHint | null> => {
  try {
    const res = await fetch(`${apiBase()}/v2/auth/password-policy`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const parsed = passwordPolicyHintSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
});

/**
 * Signed-in visitors do not belong on guest pages: send them where `homePathFor` says. A lapsed
 * access token with a live refresh token is refreshed first instead of showing the sign-in form, and a
 * signed-in platform operator goes to the console (Reference bounces every signed-in admin the same way).
 * Do not call this on the email-link landing pages (they must work while signed in).
 */
export async function redirectIfSignedIn(): Promise<void> {
  const { session, expired } = await getSession();
  if (session) redirect(homePathFor(session));
  if (expired) redirect('/api/auth/refresh?next=/');
  const operator = await getOperatorSession();
  if (operator.session) redirect('/admin');
}

/** The referral code remembered by the proxy (httpOnly cookie), or ''. */
export async function referralFromCookie(): Promise<string> {
  return referralFromParam((await cookies()).get(REFERRAL_COOKIE)?.value);
}

/** The workspace slug this browser last signed in to (`crm_org`, set by the sign-in route). */
export async function lastWorkspaceSlug(): Promise<string> {
  return (await cookies()).get(ORG_COOKIE)?.value ?? '';
}

/** First value of a Next.js search param. */
export function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** Workspace slugs are letters, digits, dash and underscore (contract `orgSlugSchema`); anything else is dropped. */
export function cleanSlug(value: string): string {
  const v = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(v) ? v : '';
}

export type GuestPageName =
  | 'login'
  | 'signup'
  | 'verifyOtp'
  | 'forgot'
  | 'reset'
  | 'verifyEmail'
  | 'findWorkspace'
  | 'confirmEmailChange'
  | 'socialCallback';

/** `<title>` of a guest page. */
export async function guestMetadata(name: GuestPageName): Promise<Metadata> {
  const t = await getTranslations(`auth-registration-security.guest.pages.${name}`);
  return { title: t('title') };
}

/**
 * The fixed left panel of the pages that ignore the admin's design (reset password and the emailed-link
 * landings): hero card, mono line, heading with accent word, one paragraph.
 */
export async function guestPanel(
  name: 'reset' | 'verifyEmail' | 'confirmEmailChange',
): Promise<FixedPanel> {
  const t = await getTranslations(`auth-registration-security.guest.pages.${name}.panel`);
  return {
    heroTitle: t('heroTitle'),
    heroDesc: t('heroDesc'),
    eyebrow: t('eyebrow'),
    heading: t('heading'),
    accent: t('accent'),
    subheading: t('subheading'),
  };
}

/** The fixed copy above the form for pages that are not one of the three editable ones. */
export async function guestHeader(
  name: GuestPageName,
): Promise<{ eyebrow: string; title: string; accent: string; subtitle: string }> {
  const t = await getTranslations(`auth-registration-security.guest.pages.${name}`);
  return {
    eyebrow: t('eyebrow'),
    title: t('heading'),
    accent: t('accent'),
    subtitle: t('subtitle'),
  };
}
