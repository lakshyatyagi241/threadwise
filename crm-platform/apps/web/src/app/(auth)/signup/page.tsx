import { Alert } from '@crm/ui';
import { getTranslations } from 'next-intl/server';
import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import { sanitizeReferral } from '@/features/auth-registration-security/guest/referral';
import {
  firstParam,
  guestMetadata,
  loadRegistrationConfig,
  redirectIfSignedIn,
} from '@/features/auth-registration-security/guest/server';
import { SignupForm } from '@/features/auth-registration-security/guest/signup-form';

export const generateMetadata = () => guestMetadata('signup');

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Sign-up step 1 (TW-AUTH-005): creates the workspace and its first user together. */
export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  await redirectIfSignedIn();
  const config = await loadRegistrationConfig();
  const t = await getTranslations('auth-registration-security.guest.signup');
  return (
    <GuestFrame page="register" config={config}>
      <div className="space-y-4">
        {firstParam(sp.restart) === '1' && <Alert tone="warning">{t('restart')}</Alert>}
        <SignupForm config={config} referralParam={sanitizeReferral(firstParam(sp.ref))} />
      </div>
    </GuestFrame>
  );
}
