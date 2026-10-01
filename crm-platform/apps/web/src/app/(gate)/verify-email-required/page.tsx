import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { gatePageRedirect } from '@/features/auth-registration-security/account/gate-target';
import { VerifyEmailRequiredView } from '@/features/auth-registration-security/account/lock/verify-email-required-view';
import { getRequestSession } from '@/features/auth-registration-security/shared/session.server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.account.verifyRequired');
  return { title: t('title') };
}

/** Lock screen for an unverified email under the "block" policy (TW-AUTH-015/016). */
export default async function VerifyEmailRequiredPage() {
  const { session } = await getRequestSession();
  if (!session) redirect('/login');
  const to = gatePageRedirect('verifyEmail', { flags: session.flags, landing: session.landing });
  if (to) redirect(to);
  return <VerifyEmailRequiredView />;
}
