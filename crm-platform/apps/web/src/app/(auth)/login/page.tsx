import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import { LoginForm } from '@/features/auth-registration-security/guest/login-form';
import { safeNextPath } from '@/features/auth-registration-security/guest/next-path';
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
          : firstParam(sp.expired) === 'idle'
            ? 'idle'
            : null;
  const minutes = Number.parseInt(firstParam(sp.minutes) ?? '', 10);

  return (
    <GuestFrame page="login" config={config}>
      <LoginForm
        config={config}
        defaultOrg={defaultOrg}
        next={safeNextPath(firstParam(sp.next))}
        flash={flash}
        idleMinutes={flash === 'idle' && minutes > 0 && minutes <= 10080 ? minutes : null}
        loggedOut={firstParam(sp.logout) === '1'}
      />
    </GuestFrame>
  );
}
