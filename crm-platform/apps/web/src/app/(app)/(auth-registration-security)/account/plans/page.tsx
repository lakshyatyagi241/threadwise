import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlansPlaceholder } from '@/features/auth-registration-security/account/plans/plans-placeholder';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.account.plans');
  return { title: t('title') };
}

/** The destination of every "upgrade" link until the billing domain builds the real plan picker and checkout. */
export default function PlansPage() {
  return <PlansPlaceholder />;
}
