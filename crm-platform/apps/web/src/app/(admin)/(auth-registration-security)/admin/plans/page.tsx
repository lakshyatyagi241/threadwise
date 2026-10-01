import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlansPage } from '@/features/auth-registration-security/platform/plans/plans-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth-registration-security.platform');
  return { title: t('nav.plans') };
}

export default function OperatorPlansPage() {
  return <PlansPage />;
}
