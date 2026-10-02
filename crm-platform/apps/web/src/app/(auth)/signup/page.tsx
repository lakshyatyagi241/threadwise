import { Alert } from '@/features/auth-registration-security/guest/ui';
import { getTranslations } from 'next-intl/server';
import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import { referralFromParam } from '@/features/auth-registration-security/guest/referral';
import {
  firstParam,
  guestMetadata,
  loadPasswordPolicy,
  loadRegistrationConfig,
  redirectIfSignedIn,
  referralFromCookie,
} from '@/features/auth-registration-security/guest/server';
import { SignupForm } from '@/features/auth-registration-security/guest/signup-form';

export const generateMetadata = () => guestMetadata('signup');

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Sign-up step 1 (TW-AUTH-005): creates the workspace and its first user together. */
export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  await redirectIfSignedIn();
  const [config, policy, cookieReferral] = await Promise.all([
    loadRegistrationConfig(),
    loadPasswordPolicy(),
    referralFromCookie(),
  ]);
  const t = await getTranslations('auth-registration-security.guest.signup');
  const restart = firstParam(sp.restart) === '1';
  return (
    <GuestFrame page="register" config={config}>
      {restart && (
        <Alert tone="warning" className="mb-4">
          {t('restart')}
        </Alert>
      )}
      <SignupForm
        config={config}
        // The link wins over the 30-day cookie (Reference's order); typing in the box wins over both.
        referral={referralFromParam(firstParam(sp.ref)) || cookieReferral}
        passwordPolicy={policy}
        restore={restart || firstParam(sp.back) === '1'}
        slugConflict={firstParam(sp.slug) === 'taken'}
      />
    </GuestFrame>
  );
}
