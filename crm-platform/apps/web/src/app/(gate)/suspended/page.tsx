import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { SuspendedView } from '@/features/auth-registration-security/account/lock/suspended-view';
import { gatePageRedirect } from '@/features/auth-registration-security/account/gate-target';
import { getRequestSession } from '@/features/auth-registration-security/shared/session.server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.account.suspended');
  return { title: t('title') };
}

/** Lock screen for a suspended account (TW-AUTH-016). Anyone else is sent on to where they belong. */
export default async function SuspendedPage() {
  const { session } = await getRequestSession();
  if (!session) redirect('/login');
  const to = gatePageRedirect('suspended', { flags: session.flags, landing: session.landing });
  if (to) redirect(to);
  return <SuspendedView />;
}
