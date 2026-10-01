import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import { LoginForm } from '@/features/auth-registration-security/guest/login-form';
import { safeNextPath } from '@/features/auth-registration-security/guest/next-path';
import { sanitizeReferral } from '@/features/auth-registration-security/guest/referral';
import {
  cleanSlug,
  firstParam,
  lastWorkspaceSlug,
  loadRegistrationConfig,
  redirectIfSignedIn,
} from '@/features/auth-registration-security/guest/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.guest.pages');
  return { title: t('login.title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Sign-in (WD-AUTH-001): guests only, in the design the platform admin picked. */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  await redirectIfSignedIn();
  const config = await loadRegistrationConfig();
  const defaultOrg = cleanSlug(firstParam(sp.org)) || cleanSlug(await lastWorkspaceSlug());
  const flash =
    firstParam(sp.account_deleted) === '1'
      ? 'deleted'
      : firstParam(sp.reset) === '1'
        ? 'reset'
        : firstParam(sp.expired) === '1'
          ? 'expired'
          : null;

  return (
    <GuestFrame page="login" config={config}>
      <LoginForm
        config={config}
        defaultOrg={defaultOrg}
        next={safeNextPath(firstParam(sp.next))}
        flash={flash}
        loggedOut={firstParam(sp.logout) === '1'}
        referral={sanitizeReferral(firstParam(sp.ref))}
      />
    </GuestFrame>
  );
}
