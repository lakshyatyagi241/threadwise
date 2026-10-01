import 'server-only';
import {
  registrationConfigResponseSchema,
  type AuthPageTextField,
  type RegistrationConfigResponse,
} from '@crm/contracts';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ORG_COOKIE } from '@/lib/auth/cookies';
import { apiBase, getSession, homePathFor } from '@/lib/auth/server';

/**
 * What the guest pages need from the server: the public configuration (copy, design, captcha,
 * social buttons, sign-up policy) and the "already signed in" redirect (WD-AUTH-011).
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
  emailVerification: 'banner',
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
    extra: { login: {}, register: {} },
  },
  links: { terms: '/legal/terms', privacy: '/legal/privacy', cookies: null },
};

export async function loadRegistrationConfig(): Promise<RegistrationConfigResponse> {
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
 * Signed-in visitors do not belong on guest pages: send them where `homePathFor` says. A lapsed
 * access token with a live refresh token is refreshed first instead of showing the sign-in form.
 * Do not call this on the email-link landing pages (they must work while signed in).
 */
export async function redirectIfSignedIn(): Promise<void> {
  const { session, expired } = await getSession();
  if (session) redirect(homePathFor(session));
  if (expired) redirect('/api/auth/refresh?next=/');
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
