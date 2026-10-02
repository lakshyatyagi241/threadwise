import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { registrationConfigResponseSchema } from '@crm/contracts';
import { OperatorLogin } from '@/features/auth-registration-security/platform/login/operator-login';
import type { CaptchaConfig } from '@/features/auth-registration-security/platform/login/use-recaptcha';
import {
  OPERATOR_ACCOUNT_PATH,
  OPERATOR_HOME,
} from '@/features/auth-registration-security/platform/operator-nav';
import { safeConsolePath } from '@/features/auth-registration-security/platform/lib/next-path';
import { apiBase, getOperatorSession } from '@/lib/auth/server';

/** Captcha is configured by the platform; the public config says whether the sign-in form needs it. */
async function captchaConfig(): Promise<CaptchaConfig | null> {
  try {
    const res = await fetch(`${apiBase()}/v2/auth/registration-config`, { cache: 'no-store' });
    if (!res.ok) return null;
    const parsed = registrationConfigResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.captcha : null;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.platform');
  return { title: t('login.title') };
}

export default async function OperatorLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string; minutes?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = safeConsolePath(params.next, OPERATOR_HOME);
  const { session, expired } = await getOperatorSession();
  if (session) redirect(session.mfaEnrolmentRequired ? OPERATOR_ACCOUNT_PATH : next);
  // A refresh cookie without a usable access token: rotate it instead of asking for a password. Not when the
  // address already says why the session ended (expired, or idle): the refresh would only fail again.
  if (expired && !params.expired)
    redirect(`/api/platform-auth/refresh?next=${encodeURIComponent(next)}`);
  // Signed out for inactivity (WD-AUTH-033): the notice names the limit; without a usable number it is the plain one.
  const minutes = Number.parseInt(params.minutes ?? '', 10);
  const idleMinutes = params.expired === 'idle' && minutes > 0 && minutes <= 10080 ? minutes : null;
  return (
    <OperatorLogin
      expired={params.expired === '1' || (params.expired === 'idle' && idleMinutes === null)}
      idleMinutes={idleMinutes}
      next={next}
      captcha={await captchaConfig()}
    />
  );
}
