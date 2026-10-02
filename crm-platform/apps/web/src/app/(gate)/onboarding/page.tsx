import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { gatePageRedirect } from '@/features/auth-registration-security/account/gate-target';
import { GuestFrame } from '@/features/auth-registration-security/guest/guest-frame';
import { loadRegistrationConfig } from '@/features/auth-registration-security/guest/server';
import { OnboardingView } from '@/features/auth-registration-security/account/onboarding/onboarding-view';
import { getRequestSession } from '@/features/auth-registration-security/shared/session.server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.account.onboarding');
  return { title: t('metaTitle') };
}

/** First-run setup, steps 2 and 3 of 3 (WD-AUTH-008/009). Step 1 was the sign-up form. */
export default async function OnboardingPage() {
  const { session } = await getRequestSession();
  if (!session) redirect('/login');
  const to = gatePageRedirect('onboarding', { flags: session.flags, landing: session.landing });
  if (to) redirect(to);
  // Steps 2 and 3 of sign-up sit in the sign-up page's chrome; the view draws its own title block.
  const config = await loadRegistrationConfig();
  return (
    <GuestFrame page="register" config={config} header={null}>
      <OnboardingView defaultCountryIso={config.defaultCountryIso} />
    </GuestFrame>
  );
}
